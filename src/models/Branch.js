import mongoose from 'mongoose';

const branchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide branch name'],
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    // The admin who manages this branch (must be role: 'admin')
    branchAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    // Users (staff) assigned to this branch
    assignedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    active: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
    },
  },
  { timestamps: true }
);

export const Branch = mongoose.model('Branch', branchSchema);
