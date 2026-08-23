import mongoose from 'mongoose';

const stockMovementSchema = new mongoose.Schema(
  {
    transactionType: {
      type: String,
      enum: ['stock_in', 'stock_out', 'opening_stock', 'adjustment', 'purchase'],
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
    },
    quantity: {
      type: Number,
      required: true,
    },
    unitPrice: {
      type: Number,
      default: 0,
    },
    totalPrice: {
      type: Number,
      default: 0,
    },
    referenceNo: {
      type: String,
      trim: true,
    },
    supplier: {
      type: String,
      trim: true,
    },
    customer: {
      type: String,
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
    },
    salesPerson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    salesPersonName: {
      type: String,
      trim: true,
    },
    invoiceNumber: {
      type: String,
      trim: true,
    },
    invoiceUrl: {
      type: String,
      trim: true,
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
    },
    notes: {
      type: String,
      trim: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'performerModel',
    },
    performerModel: {
      type: String,
      enum: ['User', 'Admin'],
      default: 'User',
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
