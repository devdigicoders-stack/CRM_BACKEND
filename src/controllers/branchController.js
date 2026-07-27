import { Branch } from '../models/Branch.js';
import { Admin } from '../models/Admin.js';
import { User } from '../models/User.js';
import { Lead } from '../models/Lead.js';

// @desc   Create a new branch
// @route  POST /api/v1/branches
// @access superAdmin only
export const createBranch = async (req, res, next) => {
  try {
    const { name, description, branchAdmin, assignedUsers } = req.body;

    if (!name) {
      res.status(400);
      throw new Error('Branch name is required');
    }

    // Validate branchAdmin if provided
    if (branchAdmin) {
      const adminDoc = await Admin.findById(branchAdmin);
      if (!adminDoc || adminDoc.role !== 'admin') {
        res.status(400);
        throw new Error('branchAdmin must be a valid admin user');
      }
    }

    const branch = await Branch.create({
      name,
      description,
      branchAdmin: branchAdmin || null,
      assignedUsers: assignedUsers || [],
      createdBy: req.user._id,
    });

    const populated = await Branch.findById(branch._id)
      .populate('branchAdmin', 'name email role')
      .populate('assignedUsers', 'name email role phone active')
      .populate('createdBy', 'name email');

    res.status(201).json({ status: 'success', data: { branch: populated } });
  } catch (error) {
    next(error);
  }
};

// @desc   Get all branches
// @route  GET /api/v1/branches
// @access superAdmin — all; branchAdmin — only their own
export const getBranches = async (req, res, next) => {
  try {
    let query = {};

    if (req.user.role === 'admin') {
      // branchAdmin sees only their branch
      query = { branchAdmin: req.user._id };
    }

    const branches = await Branch.find(query)
      .populate('branchAdmin', 'name email role')
      .populate('assignedUsers', 'name email role phone active')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({ status: 'success', data: { branches } });
  } catch (error) {
    next(error);
  }
};

// @desc   Get single branch
// @route  GET /api/v1/branches/:id
// @access superAdmin or that branch's admin
export const getBranchById = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id)
      .populate('branchAdmin', 'name email role')
      .populate('assignedUsers', 'name email role phone active')
      .populate('createdBy', 'name email');

    if (!branch) {
      res.status(404);
      throw new Error('Branch not found');
    }

    // branchAdmin can only see their own branch
    if (
      req.user.role === 'admin' &&
      branch.branchAdmin?._id?.toString() !== req.user._id.toString()
    ) {
      res.status(403);
      throw new Error('Access denied');
    }

    res.status(200).json({ status: 'success', data: { branch } });
  } catch (error) {
    next(error);
  }
};

// @desc   Update branch (name, description, branchAdmin, assignedUsers)
// @route  PUT /api/v1/branches/:id
// @access superAdmin only
export const updateBranch = async (req, res, next) => {
  try {
    const { name, description, branchAdmin, assignedUsers, active } = req.body;

    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      res.status(404);
      throw new Error('Branch not found');
    }

    if (branchAdmin !== undefined) {
      if (branchAdmin) {
        const adminDoc = await Admin.findById(branchAdmin);
        if (!adminDoc || adminDoc.role !== 'admin') {
          res.status(400);
          throw new Error('branchAdmin must be a valid admin user');
        }
      }
      branch.branchAdmin = branchAdmin || null;
    }

    if (name) branch.name = name;
    if (description !== undefined) branch.description = description;
    if (assignedUsers) branch.assignedUsers = assignedUsers;
    if (active !== undefined) branch.active = active;

    await branch.save();

    const populated = await Branch.findById(branch._id)
      .populate('branchAdmin', 'name email role')
      .populate('assignedUsers', 'name email role phone active')
      .populate('createdBy', 'name email');

    res.status(200).json({ status: 'success', data: { branch: populated } });
  } catch (error) {
    next(error);
  }
};

// @desc   Delete branch
// @route  DELETE /api/v1/branches/:id
// @access superAdmin only
export const deleteBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      res.status(404);
      throw new Error('Branch not found');
    }
    await branch.deleteOne();
    res.status(200).json({ status: 'success', message: 'Branch deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc   Get branch dashboard stats + leads + users
// @route  GET /api/v1/branches/:id/dashboard
// @access superAdmin or that branch's admin
export const getBranchDashboard = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id)
      .populate('branchAdmin', 'name email role')
      .populate('assignedUsers', 'name email role phone active');

    if (!branch) {
      res.status(404);
      throw new Error('Branch not found');
    }

    if (
      req.user.role === 'admin' &&
      branch.branchAdmin?._id?.toString() !== req.user._id.toString()
    ) {
      res.status(403);
      throw new Error('Access denied');
    }

    const userIds = branch.assignedUsers.map((u) => u._id);

    // Leads created by or assigned to branch users
    const leads = await Lead.find({
      $or: [
        { assignedTo: { $in: userIds } },
        { createdBy: { $in: userIds } },
      ],
    })
      .populate('assignedTo', 'name email role')
      .sort({ updatedAt: -1 })
      .lean();

    // Stats
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

// @desc   Get all users not yet assigned to any branch (for assignment dropdown)
// @route  GET /api/v1/branches/available-users
// @access superAdmin only
export const getAvailableUsers = async (req, res, next) => {
  try {
    // Get all user IDs already in any branch
    const allBranches = await Branch.find({}).select('assignedUsers').lean();
    const assignedIds = allBranches.flatMap((b) => b.assignedUsers.map((id) => id.toString()));

    const users = await User.find({ active: true }).select('name email role phone').lean();
    const admins = await Admin.find({ role: 'admin', active: true }).select('name email role').lean();

    res.status(200).json({
      status: 'success',
      data: {
        users,
        admins,
        assignedUserIds: assignedIds,
      },
    });
  } catch (error) {
    next(error);
  }
};
