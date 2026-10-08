import mongoose from 'mongoose';

const stockDeleteRequestSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      enum: ['Product', 'Category', 'Brand', 'Unit', 'Warehouse', 'StockMovement'],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    itemDetails: {
      type: String,
      trim: true,
    },
    itemData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    reason: {
      type: String,
      trim: true,
      default: 'Deletion requested from Stock panel',
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'requestedByModel',
      required: true,
    },
    requestedByModel: {
      type: String,
      enum: ['User', 'Admin'],
      default: 'User',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'actionByModel',
      default: null,
    },
    actionByModel: {
      type: String,
      enum: ['Admin', 'User'],
      default: 'Admin',
    },
    actionAt: {
      type: Date,
      default: null,
    },
    actionRemarks: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

stockDeleteRequestSchema.index({ status: 1, createdAt: -1 });
stockDeleteRequestSchema.index({ itemType: 1, itemId: 1 });

export const StockDeleteRequest = mongoose.model('StockDeleteRequest', stockDeleteRequestSchema);
