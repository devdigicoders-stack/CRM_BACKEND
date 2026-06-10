import { Admin } from '../models/Admin.js';
import { User } from '../models/User.js';

const VALID_PERMISSIONS = ['leads', 'accounts', 'installation', 'reports', 'settings', 'users', 'dashboard'];

// @desc    Create a new user (decides collection by role)
// @route   POST /api/v1/users
// @access  Private (Super Admin and Admin only)
export const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, permissions } = req.body;

    if (!name || !email || !password || !role) {
      res.status(400);
      throw new Error('Please provide name, email, password, and role');
    }

    const targetRole = role === 'sales_rep' ? 'sales' : role;

    // Check role validity
    const isAdminRole = ['superAdmin', 'admin'].includes(targetRole);
    const isUserRole = ['accountant', 'sales', 'calling', 'installation', 'crmuser'].includes(targetRole);

    if (!isAdminRole && !isUserRole) {
      res.status(400);
      throw new Error('Invalid role. Allowed roles: admin, superAdmin, accountant, sales (or sales_rep), calling, installation, crmuser');
    }

    // Role hierarchy checks
    if (req.user.role === 'admin' && targetRole === 'superAdmin') {
      res.status(403);
      throw new Error('Admins are not authorized to create a Super Admin');
    }

    // Check if email already taken in either collection
    const adminExists = await Admin.findOne({ email });
    const userExists = await User.findOne({ email });
    if (adminExists || userExists) {
      res.status(400);
      throw new Error('User already exists with this email');
    }

    // Create inside correct collection
    let newUser;
    if (isAdminRole) {
      const sanitizedPermissions = Array.isArray(permissions)
        ? permissions.filter((p) => VALID_PERMISSIONS.includes(p))
        : [];
      newUser = await Admin.create({ name, email, password, role: targetRole, phone, permissions: targetRole === 'superAdmin' ? VALID_PERMISSIONS : sanitizedPermissions });
    } else {
      newUser = await User.create({ name, email, password, role: targetRole, phone });
    }

    newUser.password = undefined;

    res.status(201).json({
      status: 'success',
      data: {
        user: newUser,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get sales users list (for lead assignment dropdown)
// @route   GET /api/v1/users/sales-list
// @access  Private (all logged in users)
export const getSalesUsers = async (req, res, next) => {
  try {
    const users = await User.find({ role: 'sales', active: true })
      .select('name email phone role')
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      status: 'success',
      results: users.length,
      data: { users },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single user by ID
// @route   GET /api/v1/users/:id
// @access  Private (Super Admin and Admin only)
export const getUserById = async (req, res, next) => {
  try {
    let user = await Admin.findById(req.params.id).lean();
    if (!user) user = await User.findById(req.params.id).lean();

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    user.password = undefined;

    res.status(200).json({
      status: 'success',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all users (searches both collections dynamically and merges)
// @route   GET /api/v1/users
// @access  Private (Super Admin and Admin only)
export const getUsers = async (req, res, next) => {
  try {
    const { search, role, active, page = 1, limit = 10 } = req.query;

    const query = {};

    // Apply active status filtering
    if (active !== undefined) {
      query.active = active === 'true';
    }

    // Apply search filter (name, email, or phone)
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skipNum = (pageNum - 1) * limitNum;

    let users = [];
    let total = 0;

    if (role) {
      // Query specific collection based on role
      const isFilterAdmin = ['superAdmin', 'admin'].includes(role);
      const targetModel = isFilterAdmin ? Admin : User;
      
      query.role = role;
      total = await targetModel.countDocuments(query);
      users = await targetModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean();
    } else {
      // Query both collections and merge
      const adminsList = await Admin.find(query).lean();
      const usersList = await User.find(query).lean();
      
      // Merge and sort by creation date descending
      const mergedList = [...adminsList, ...usersList].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      total = mergedList.length;
      users = mergedList.slice(skipNum, skipNum + limitNum);
    }

    res.status(200).json({
      status: 'success',
      results: users.length,
      total,
      pages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: {
        users,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a user (checks both collections)
// @route   PUT /api/v1/users/:id
// @access  Private (Super Admin and Admin only)
export const updateUser = async (req, res, next) => {
  try {
    const { name, email, role, phone, permissions } = req.body;

    // Search in Admins first
    let userToUpdate = await Admin.findById(req.params.id);
    let isAdminCollection = true;

    // Search in Users if not in Admins
    if (!userToUpdate) {
      userToUpdate = await User.findById(req.params.id);
      isAdminCollection = false;
    }

    if (!userToUpdate) {
      res.status(404);
      throw new Error('User not found');
    }

    // Role restrictions
    if (userToUpdate.role === 'superAdmin' && req.user.role !== 'superAdmin') {
      res.status(403);
      throw new Error('You do not have permission to modify a Super Admin');
    }

    if (role === 'superAdmin' && req.user.role !== 'superAdmin') {
      res.status(403);
      throw new Error('Only Super Admins can promote users to Super Admin');
    }

    // Email check if changed
    if (email && email !== userToUpdate.email) {
      const emailTakenAdmin = await Admin.findOne({ email });
      const emailTakenUser = await User.findOne({ email });
      if (emailTakenAdmin || emailTakenUser) {
        res.status(400);
        throw new Error('Email is already taken by another account');
      }
      userToUpdate.email = email;
    }

    if (name) userToUpdate.name = name;
    if (phone) userToUpdate.phone = phone;
    if (permissions !== undefined && isAdminCollection && userToUpdate.role !== 'superAdmin') {
      userToUpdate.permissions = Array.isArray(permissions)
        ? permissions.filter((p) => VALID_PERMISSIONS.includes(p))
        : [];
    }

    // If changing role, check if collection move is needed
    if (role && role !== userToUpdate.role) {
      const wasAdminRole = ['superAdmin', 'admin'].includes(userToUpdate.role);
      const isNewAdminRole = ['superAdmin', 'admin'].includes(role);

      if (wasAdminRole === isNewAdminRole) {
        // Simple role update in same collection
        userToUpdate.role = role;
      } else {
        // Must move between collections
        const originalPassword = await (isAdminCollection ? Admin : User)
          .findById(userToUpdate._id)
          .select('+password')
          .lean();

        // Remove from current collection
        await (isAdminCollection ? Admin : User).findByIdAndDelete(userToUpdate._id);

        // Insert into new collection
        const modelToInsert = isNewAdminRole ? Admin : User;
        const movedUser = await modelToInsert.create({
          _id: userToUpdate._id,
          name: userToUpdate.name,
          email: userToUpdate.email,
          password: originalPassword.password, // Pre-hashed, but pre-save hook won't double hash if handled properly
          role: role,
          phone: userToUpdate.phone,
          active: userToUpdate.active,
        });

        movedUser.password = undefined;
        return res.status(200).json({
          status: 'success',
          data: {
            user: movedUser,
          },
        });
      }
    }

    const updatedUser = await userToUpdate.save();
    updatedUser.password = undefined;

    res.status(200).json({
      status: 'success',
      data: {
        user: updatedUser,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update admin permissions (SuperAdmin only)
// @route   PUT /api/v1/users/:id/permissions
// @access  Private (Super Admin only)
export const updateUserPermissions = async (req, res, next) => {
  try {
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      res.status(400);
      throw new Error('permissions must be an array');
    }

    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      res.status(404);
      throw new Error('Admin not found');
    }

    if (admin.role === 'superAdmin') {
      res.status(403);
      throw new Error('Cannot modify Super Admin permissions');
    }

    const sanitized = permissions.filter((p) => VALID_PERMISSIONS.includes(p));
    const invalid = permissions.filter((p) => !VALID_PERMISSIONS.includes(p));

    admin.permissions = sanitized;
    await admin.save();

    res.status(200).json({
      status: 'success',
      message: `Permissions updated successfully${invalid.length ? `. Ignored invalid: ${invalid.join(', ')}` : ''}`,
      data: {
        adminId: admin._id,
        name: admin.name,
        permissions: admin.permissions,
        availablePermissions: VALID_PERMISSIONS,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user password (SuperAdmin only)
// @route   PUT /api/v1/users/:id/password
// @access  Private (Super Admin only)
export const updateUserPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      res.status(400);
      throw new Error('Please provide newPassword');
    }

    let user = await Admin.findById(req.params.id).select('+password');
    if (!user) user = await User.findById(req.params.id).select('+password');

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Password updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a user (SuperAdmin only)
// @route   DELETE /api/v1/users/:id
// @access  Private (Super Admin only)
export const deleteUser = async (req, res, next) => {
  try {
    let user = await Admin.findById(req.params.id);
    let isAdminCollection = true;

    if (!user) {
      user = await User.findById(req.params.id);
      isAdminCollection = false;
    }

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    if (user.role === 'superAdmin') {
      res.status(403);
      throw new Error('Super Admin account cannot be deleted');
    }

    await (isAdminCollection ? Admin : User).findByIdAndDelete(req.params.id);

    res.status(200).json({
      status: 'success',
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @route   PUT /api/v1/users/:id/toggle-status
// @access  Private (Super Admin and Admin only)
export const toggleUserStatus = async (req, res, next) => {
  try {
    let userToToggle = await Admin.findById(req.params.id);

    if (!userToToggle) {
      userToToggle = await User.findById(req.params.id);
    }

    if (!userToToggle) {
      res.status(404);
      throw new Error('User not found');
    }

    // Admins cannot toggle status of Super Admin
    if (userToToggle.role === 'superAdmin' && req.user.role !== 'superAdmin') {
      res.status(403);
      throw new Error('You do not have permission to change status of a Super Admin');
    }

    userToToggle.active = !userToToggle.active;
    await userToToggle.save();

    res.status(200).json({
      status: 'success',
      message: `User account has been ${userToToggle.active ? 'activated' : 'deactivated'} successfully`,
      data: {
        user: {
          id: userToToggle._id,
          name: userToToggle.name,
          email: userToToggle.email,
          role: userToToggle.role,
          active: userToToggle.active,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
