import mongoose from 'mongoose';

const unitSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Unit name is required'],
      unique: true,
      trim: true,
    },
    shortName: {
      type: String,
      required: [true, 'Unit short name is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

export const Unit = mongoose.model('Unit', unitSchema);
