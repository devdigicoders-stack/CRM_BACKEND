import mongoose from 'mongoose';

const remarkSchema = new mongoose.Schema(
  {
    note: {
      type: String,
      required: [true, 'Remark note is required'],
      trim: true,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide the lead name'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Please provide the lead phone number'],
      trim: true,
      validate: {
        validator: function (v) {
          // Strip all non-digits, must be exactly 10 digits
          const digits = v.replace(/\D/g, '');
          return digits.length === 10;
        },
        message: props => `Phone number "${props.value}" is invalid — must be exactly 10 digits`,
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    source: {
      type: String,
      trim: true,
      default: 'Direct',
    },
    status: {
      type: String,
      enum: ['new', 'assigned', 'interested', 'in_process', 'not_interested', 'converted', 'closed'],
      default: 'new',
    },
    priority: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium',
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'assignedToModel',
    },
    assignedToModel: {
      type: String,
      enum: ['User', 'Admin'],
      default: 'User',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'createdByModel',
      required: true,
    },
    createdByModel: {
      type: String,
      enum: ['User', 'Admin'],
      default: 'User',
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'assignedByModel',
    },
    assignedByModel: {
      type: String,
      enum: ['User', 'Admin'],
    },
    followUpDate: {
      type: Date,
    },
    remarks: [remarkSchema],
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
    accountRemarks: {
      type: String,
      trim: true,
    },
    invoiceUrl: {
      type: String,
      trim: true,
    },
    trackingId: {
      type: String,
      trim: true,
    },
    paymentMode: {
      type: String,
      enum: ['cash', 'cod', 'dp', 'emi'],
      lowercase: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'partial', 'completed'],
      default: 'pending',
      lowercase: true,
    },
    transactionDetails: {
      type: String,
      trim: true,
    },
    transferredToInstallation: {
      type: Boolean,
      default: false,
    },
    productDetails: {
      type: String,
      trim: true,
    },
    dealValue: {
      type: Number,
      default: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    pendingAmount: {
      type: Number,
      default: 0,
    },
    paymentScreenshot: {
      type: String,
      trim: true,
    },
    saleDocumentsUrl: {
      type: String,
      trim: true,
    },
    transferredToAccounts: {
      type: Boolean,
      default: false,
    },
    saleConfirmedAt: {
      type: Date,
    },
    saleConfirmedAt: {
      type: Date,
    },
    deliveryStatus: {
      type: String,
      enum: ['pending', 'in_progress', 'delivered'],
      default: 'pending',
      lowercase: true,
    },
    expectedDeliveryDate: {
      type: Date,
    },
    installationRep: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    installationStatus: {
      type: String,
      enum: ['assigned', 'in_progress', 'completed'],
      default: 'assigned',
    },
    installationProgressRemarks: {
      type: String,
      trim: true,
    },
    installationProofUrl: {
      type: String,
      trim: true,
    },
    installationIssueReported: {
      type: Boolean,
      default: false,
    },
    installationIssueRemarks: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for searching leads by name, phone or email
leadSchema.index({ name: 'text', phone: 'text', email: 'text' });

// Performance optimization indexes
leadSchema.index({ assignedTo: 1, status: 1 });
leadSchema.index({ followUpDate: 1 });

export const Lead = mongoose.model('Lead', leadSchema);
