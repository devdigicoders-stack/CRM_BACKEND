import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Admin } from '../models/Admin.js';
import { User } from '../models/User.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // 1) Get token from request headers
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      res.status(401);
      throw new Error('Not authorized, no token provided');
    }

    // 2) Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      res.status(401);
      throw new Error('Not authorized, invalid or expired token');
    }

    // 3) Find user in database (checks admins collection first, then users)
    let currentUser = await Admin.findById(decoded.id);
    
    if (!currentUser) {
      currentUser = await User.findById(decoded.id);
    }

    if (!currentUser) {
      res.status(401);
      throw new Error('The user belonging to this token no longer exists');
    }

    if (!currentUser.active) {
      res.status(401);
      throw new Error('This user account has been deactivated');
    }

    // 4) Attach user to request object
    req.user = currentUser;
    next();
  } catch (error) {
    next(error);
  }
};

export const checkPermission = (panel) => {
  return (req, res, next) => {
    if (!req.user) {
      res.status(500);
      return next(new Error('User object not found on request'));
    }

    // superAdmin has access to everything
    if (req.user.role === 'superAdmin') return next();

    // admin has access to everything
    if (req.user.role === 'admin') return next();

    // For regular users, check permissions array
    if (!req.user.permissions || !req.user.permissions.includes(panel)) {
      res.status(403);
      return next(new Error(`Access denied. You do not have permission for the '${panel}' panel.`));
    }

    next();
  };
};

export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      res.status(500);
      return next(new Error('User object not found on request, please check if protect middleware is applied first'));
    }

    if (!roles.includes(req.user.role)) {
      res.status(403);
      return next(new Error('You do not have permission to perform this action'));
    }

    next();
  };
};
