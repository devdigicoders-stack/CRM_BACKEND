import jwt from 'jsonwebtoken';
import { Admin } from '../models/Admin.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';

// Helper to sign JWT token
const signToken = (id) => {
  return jwt.sign({ id }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
};

// @desc    Register a new user (decides Admin vs User collection dynamically)
// @route   POST /api/v1/auth/register
// @access  Public (for initial setup, can be restricted later)
export const register = async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;

    const targetRole = role === 'sales_rep' ? 'sales' : (role || 'sales');

    // 1) Verify role exists in valid sets
    const isAdminRole = ['superAdmin', 'admin'].includes(targetRole);
    const isUserRole = ['accountant', 'sales', 'calling', 'installation', 'crmuser'].includes(targetRole);

    if (!isAdminRole && !isUserRole) {
      res.status(400);
      throw new Error(`Invalid role. Allowed roles: admin, superAdmin, accountant, sales (or sales_rep), calling, installation, crmuser`);
    }

    // 2) Check if email is already taken in either collection
    const adminExists = await Admin.findOne({ email });
    const userExists = await User.findOne({ email });

    if (adminExists || userExists) {
      res.status(400);
      throw new Error('User already exists with this email');
    }

    // 3) Create user in appropriate collection
    let newUser;
    if (isAdminRole) {
      newUser = await Admin.create({ name, email, password, role: targetRole, phone });
    } else {
      newUser = await User.create({ name, email, password, role: targetRole, phone });
    }

    // 4) Generate token
    const token = signToken(newUser._id);
    newUser.password = undefined;

    res.status(201).json({
      status: 'success',
      token,
      data: {
        user: newUser,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user (checks admins first, then users)
// @route   POST /api/v1/auth/login
// @access  Public
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400);
      throw new Error('Please provide email and password');
    }

    // Find in Admins first
    let account = await Admin.findOne({ email }).select('+password');
    
    // If not found in Admins, search in Users
    if (!account) {
      account = await User.findOne({ email }).select('+password');
    }

    if (!account || !(await account.comparePassword(password))) {
      res.status(401);
      throw new Error('Incorrect email or password');
    }

    if (!account.active) {
      res.status(401);
      throw new Error('This user account has been deactivated');
    }

    // Generate token
    const token = signToken(account._id);
    account.password = undefined;

    res.status(200).json({
      status: 'success',
      token,
      data: {
        user: account,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Change password
// @route   POST /api/v1/auth/change-password
// @access  Private
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400);
      throw new Error('Please provide currentPassword and newPassword');
    }

    // Try finding in Admins
    let account = await Admin.findById(req.user.id).select('+password');

    // Try finding in Users if not in Admins
    if (!account) {
      account = await User.findById(req.user.id).select('+password');
    }

    if (!account) {
      res.status(404);
      throw new Error('Account not found');
    }

    // Check if current password is correct
    if (!(await account.comparePassword(currentPassword))) {
      res.status(401);
      throw new Error('Current password is incorrect');
    }

    // Update password (pre-save hook will hash it)
    account.password = newPassword;
    await account.save();

    res.status(200).json({
      status: 'success',
      message: 'Password updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Logout user
// @route   POST /api/v1/auth/logout
// @access  Public
export const logout = async (req, res, next) => {
  try {
    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current user profile
// @route   GET /api/v1/profile
// @access  Private
export const getProfile = async (req, res, next) => {
  try {
    const user = req.user;
    res.status(200).json({
      status: 'success',
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update current user profile
// @route   PUT /api/v1/profile
// @access  Private
export const updateProfile = async (req, res, next) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.user._id;

    // Determine collection (Admin or User)
    const isAdmin = ['superAdmin', 'admin'].includes(req.user.role);
    const Model = isAdmin ? Admin : User;

    const user = await Model.findById(userId);
    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    // If email is changing, make sure it is not taken in both Admin and User collections
    if (email && email !== user.email) {
      const emailTakenAdmin = await Admin.findOne({ email });
      const emailTakenUser = await User.findOne({ email });
      if (emailTakenAdmin || emailTakenUser) {
        res.status(400);
        throw new Error('Email is already taken by another account');
      }
      user.email = email;
    }

    if (name) user.name = name;
    if (phone) user.phone = phone;

    const updatedUser = await user.save();
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

