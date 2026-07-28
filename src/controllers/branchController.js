import { Branch } from '../models/Branch.js';
import { Admin } from '../models/Admin.js';
import { User } from '../models/User.js';
import { Lead } from '../models/Lead.js';

const populateBranch = (query) =>
  query
    .populate('branchManager', 'name email phone role active')
    .populate('assignedUsers', 'name email role phone active')
    .populate('createdBy', 'name email');

// @desc   Create a new branch + branch manager account
// @route  POST /api/v1/branches
// @access superAdmin only
// Body: { name, description, managerName, managerEmail, managerPassword, managerPhone, assignedUsers }
export const createBranch = async (req, res, next) => {
  try {
    const { name, description, managerName, managerEmail, managerPassword, managerPhone, assignedUsers } = req.body;

    if (!name) {
      res.status(400);
      throw new Error('Branch name is required');
    }

    if (!managerName || !managerEmail || !managerPassword) {
      res.status(400);
      throw new Error('Branch manager name, email and password are required');
    }

    // Check email not already taken
    const emailTakenAdmin = await Admin.findOne({ email: managerEmail });
    const emailTakenUser = await User.findOne({ email: managerEmail });
    if (emailTakenAdmin || emailTakenUser) {
      res.status(400);
      throw new Error('Email is already taken by another account');
    }

    // Create manager first, then branch — if branch fails, delete manager (manual rollback)
    const manager = await Admin.create({
      name: managerName,
      email: managerEmail,
      password: managerPassword,
      phone: managerPhone || '',
      role: 'branchManager',
    });

    let branch;
    try {
      branch = await Branch.create({
        name,
        description,
        branchManager: manager._id,
        assignedUsers: assignedUsers || [],
        createdBy: req.user._id,
      });
    } catch (branchErr) {
      // Rollback: delete manager if branch creation failed
      await Admin.findByIdAndDelete(manager._id);
      throw branchErr;
    }

    // Link branchId back to manager
    await Admin.findByIdAndUpdate(manager._id, { branchId: branch._id });

    const populated = await populateBranch(Branch.findById(branch._id));

    res.status(201).json({
      status: 'success',
      data: {
        branch: populated,
        managerCredentials: {
          email: managerEmail,
          password: managerPassword,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc   Get all branches
// @route  GET /api/v1/branches
// @access superAdmin — all; branchManager — only their own
export const getBranches = async (req, res, next) => {
  try {
    let query = {};

    if (req.user.role === 'branchManager') {
      query = { branchManager: req.user._id };
    }

    const branches = await populateBranch(Branch.find(query).sort({ createdAt: -1 }));

    res.status(200).json({ status: 'success', data: { branches } });
  } catch (error) {
    next(error);
  }
};

// @desc   Get single branch
// @route  GET /api/v1/branches/:id
// @access superAdmin or that branch's manager
export const getBranchById = async (req, res, next) => {
  try {
    const branch = await populateBranch(Branch.findById(req.params.id));

    if (!branch) {
      res.status(404);
      throw new Error('Branch not found');
    }

    if (
      req.user.role === 'branchManager' &&
      branch.branchManager?._id?.toString() !== req.user._id.toString()
    ) {
      res.status(403);
      throw new Error('Access denied');
    }

    res.status(200).json({ status: 'success', data: { branch } });
  } catch (error) {
    next(error);
  }
};

// @desc   Update branch (name, description, assignedUsers, active)
//         Also can update manager credentials
// @route  PUT /api/v1/branches/:id
// @access superAdmin only
export const updateBranch = async (req, res, next) => {
  try {
    const { name, description, assignedUsers, active, managerName, managerEmail, managerPhone, managerPassword } = req.body;

    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      res.status(404);
      throw new Error('Branch not found');
    }

    if (name) branch.name = name;
    if (description !== undefined) branch.description = description;
    if (assignedUsers) branch.assignedUsers = assignedUsers;
    if (active !== undefined) branch.active = active;

    await branch.save();

    // Update manager details if provided
    if (branch.branchManager && (managerName || managerEmail || managerPhone || managerPassword)) {
      const manager = await Admin.findById(branch.branchManager).select('+password');
      if (manager) {
        if (managerName) manager.name = managerName;
        if (managerPhone) manager.phone = managerPhone;
        if (managerPassword) manager.password = managerPassword;
        if (managerEmail && managerEmail !== manager.email) {
          const taken = await Admin.findOne({ email: managerEmail });
          const takenUser = await User.findOne({ email: managerEmail });
          if (taken || takenUser) {
            res.status(400);
            throw new Error('Email is already taken by another account');
          }
          manager.email = managerEmail;
        }
        await manager.save();
      }
    }

    const populated = await populateBranch(Branch.findById(branch._id));

    res.status(200).json({ status: 'success', data: { branch: populated } });
  } catch (error) {
    next(error);
  }
};

// @desc   Delete branch (also deletes branch manager account)
// @route  DELETE /api/v1/branches/:id
// @access superAdmin only
export const deleteBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      res.status(404);
      throw new Error('Branch not found');
    }

    // Delete the branch manager Admin account
    if (branch.branchManager) {
      await Admin.findByIdAndDelete(branch.branchManager);
    }

    await branch.deleteOne();
    res.status(200).json({ status: 'success', message: 'Branch and branch manager deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc   Get branch dashboard stats + leads + users
// @route  GET /api/v1/branches/:id/dashboard
// @access superAdmin or that branch's manager
export const getBranchDashboard = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id)
      .populate('branchManager', 'name email phone role active')
      .populate('assignedUsers', 'name email role phone active');

    if (!branch) {
      res.status(404);
      throw new Error('Branch not found');
    }

    if (
      req.user.role === 'branchManager' &&
      branch.branchManager?._id?.toString() !== req.user._id.toString()
    ) {
      res.status(403);
      throw new Error('Access denied');
    }

    const userIds = branch.assignedUsers.map((u) => u._id);

    const leads = await Lead.find({
      assignedTo: { $in: userIds },
    })
      .populate('assignedTo', 'name email role')
      .sort({ updatedAt: -1 })
      .lean();

    const totalLeads = leads.length;
    const byStatus = {};
    const byPriority = {};
    let totalDealValue = 0;

    leads.forEach((l) => {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      byPriority[l.priority] = (byPriority[l.priority] || 0) + 1;
      totalDealValue += l.dealValue || 0;
    });

    res.status(200).json({
      status: 'success',
      data: {
        branch,
        stats: {
          totalLeads,
          totalUsers: branch.assignedUsers.length,
          totalDealValue,
          byStatus,
          byPriority,
          converted: byStatus['converted'] || 0,
          pending: (byStatus['new'] || 0) + (byStatus['assigned'] || 0) + (byStatus['interested'] || 0) + (byStatus['in_process'] || 0),
        },
        leads,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc   Get all users available to assign to a branch
// @route  GET /api/v1/branches/available-users
// @access superAdmin only
export const getAvailableUsers = async (req, res, next) => {
  try {
    const allBranches = await Branch.find({}).select('assignedUsers').lean();
    const assignedIds = allBranches.flatMap((b) => b.assignedUsers.map((id) => id.toString()));

    const users = await User.find({ active: true }).select('name email role phone').lean();

    res.status(200).json({
      status: 'success',
      data: {
        users,
        assignedUserIds: assignedIds,
      },
    });
  } catch (error) {
    next(error);
  }
};
