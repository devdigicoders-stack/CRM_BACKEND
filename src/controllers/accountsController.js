import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Lead } from '../models/Lead.js';

// Configure multer storage for invoices
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/invoices';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF and image files are allowed for invoice'), false);
  }
};

export const uploadInvoiceMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).single('invoice');

// Helper to format lead response with helper integration links
const formatLeadWithIntegrations = (lead) => {
  const leadObj = lead.toObject ? lead.toObject() : lead;
  const cleanedPhone = leadObj.phone.replace(/\D/g, '');
  const phoneWithCountry = cleanedPhone.length === 10 ? `91${cleanedPhone}` : cleanedPhone;

  return {
    ...leadObj,
    integrations: {
      whatsappLink: `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(`Hello ${leadObj.name}, `)}`,
      callUri: `tel:${leadObj.phone}`,
    },
  };
};

// @desc    Get accountant dashboard statistics overview
// @route   GET /api/v1/accounts/dashboard
// @access  Private (Admins and Accountants only)
export const getAccountDashboard = async (req, res, next) => {
  try {
    // Closed Won leads query (status is converted or closed, and transferred to accounts)
    const baseQuery = { status: { $in: ['converted', 'closed'] }, transferredToAccounts: true };

    const totalClosedWon = await Lead.countDocuments(baseQuery);
    
    const pendingVerification = await Lead.countDocuments({
      ...baseQuery,
      verificationStatus: 'pending'
    });

    const verifiedSales = await Lead.countDocuments({
      ...baseQuery,
      verificationStatus: 'verified'
    });

    const rejectedSales = await Lead.countDocuments({
      ...baseQuery,
      verificationStatus: 'rejected'
    });

    const paymentStatusBreakdown = await Lead.aggregate([
      { $match: baseQuery },
      { $group: { _id: '$paymentStatus', count: { $sum: 1 } } }
    ]);

    const paymentStats = { pending: 0, partial: 0, completed: 0 };
    paymentStatusBreakdown.forEach((item) => {
      if (item._id && statsKeyExists(item._id, paymentStats)) {
        paymentStats[item._id] = item.count;
      }
    });

    res.status(200).json({
      status: 'success',
      data: {
        totalClosedWon,
        pendingVerification,
        verifiedSales,
        rejectedSales,
        paymentStatusBreakdown: paymentStats
      }
    });
  } catch (error) {
    next(error);
  }
};

const statsKeyExists = (key, obj) => {
  return Object.prototype.hasOwnProperty.call(obj, key);
};

// @desc    View Closed Won Leads (received from sales team)
// @route   GET /api/v1/accounts/leads
// @access  Private (Admins and Accountants only)
export const getClosedWonLeads = async (req, res, next) => {
  try {
    const { search, verificationStatus, paymentStatus, page = 1, limit = 20 } = req.query;

    const query = { status: { $in: ['converted', 'closed'] }, transferredToAccounts: true };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (verificationStatus) {
      query.verificationStatus = verificationStatus;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skipNum = (pageNum - 1) * limitNum;

    const total = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role')
      .populate('remarks.addedBy', 'name email role')
      .sort({ updatedAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    const formattedLeads = leads.map(formatLeadWithIntegrations);

    res.status(200).json({
      status: 'success',
      results: formattedLeads.length,
      total,
      pages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: {
        leads: formattedLeads
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve/Verify or Reject Sale
// @route   PUT /api/v1/accounts/leads/:id/verify
// @access  Private (Admins and Accountants only)
export const verifySale = async (req, res, next) => {
  try {
    const { verificationStatus, remarks } = req.body;

    if (!verificationStatus || !['verified', 'rejected'].includes(verificationStatus)) {
      res.status(400);
      throw new Error('Please provide a valid verificationStatus (verified or rejected)');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Verify lead was closed won first
    if (!['converted', 'closed'].includes(lead.status)) {
      res.status(400);
      throw new Error('Only closed won (converted/closed) sales can be verified');
    }

    lead.verificationStatus = verificationStatus;
    if (remarks) {
      lead.accountRemarks = remarks;
    }

    // Add remark entry
    lead.remarks.push({
      note: `[Accounts Team] Sale ${verificationStatus === 'verified' ? 'Approved & Verified' : 'Rejected'}. Remarks: ${remarks || 'None'}`,
      addedBy: req.user._id
    });

    // If rejected, send back to sales team
    if (verificationStatus === 'rejected') {
      lead.status = 'assigned';
      lead.transferredToAccounts = false; // Remove from accounts panel so sales team can handle it
    }

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead)
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload Invoice for a verified sale
// @route   PUT /api/v1/accounts/leads/:id/invoice
// @access  Private (Admins and Accountants only)
export const uploadInvoice = async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('Please upload an invoice file');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Convert local filepath to web url/path
    const relativePath = `/uploads/invoices/${req.file.filename}`;
    lead.invoiceUrl = relativePath;

    // Add remark entry
    lead.remarks.push({
      note: `[Accounts Team] Invoice uploaded. File: ${req.file.originalname}`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead)
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update Payment Mode, Payment Status & Add Transaction Details
// @route   PUT /api/v1/accounts/leads/:id/payment
// @access  Private (Admins and Accountants only)
export const updatePaymentAndTransaction = async (req, res, next) => {
  try {
    const { paymentMode, paymentStatus, transactionDetails } = req.body;

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    if (paymentMode) {
      if (!['cash', 'cod', 'dp', 'emi'].includes(paymentMode.toLowerCase())) {
        res.status(400);
        throw new Error('Invalid paymentMode. Allowed: cash, cod, dp, emi');
      }
      lead.paymentMode = paymentMode.toLowerCase();
    }

    if (paymentStatus) {
      if (!['pending', 'partial', 'completed'].includes(paymentStatus.toLowerCase())) {
        res.status(400);
        throw new Error('Invalid paymentStatus. Allowed: pending, partial, completed');
      }
      lead.paymentStatus = paymentStatus.toLowerCase();
    }

    if (transactionDetails) {
      lead.transactionDetails = transactionDetails;
    }

    // Add remark entry
    lead.remarks.push({
      note: `[Accounts Team] Payment/Transaction updated (Mode: ${lead.paymentMode || 'N/A'}, Status: ${lead.paymentStatus || 'N/A'})`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead)
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add Tracking ID
// @route   PUT /api/v1/accounts/leads/:id/tracking
// @access  Private (Admins and Accountants only)
export const updateTrackingId = async (req, res, next) => {
  try {
    const { trackingId } = req.body;

    if (!trackingId) {
      res.status(400);
      throw new Error('Please provide trackingId');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    lead.trackingId = trackingId;

    // Add remark entry
    lead.remarks.push({
      note: `[Accounts Team] Tracking ID updated: ${trackingId}`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead)
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Transfer Verified Leads to Installation Team
// @route   PUT /api/v1/accounts/leads/:id/transfer
// @access  Private (Admins and Accountants only)
export const transferToInstallation = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Verify lead is verified before transfer
    if (lead.verificationStatus !== 'verified') {
      res.status(400);
      throw new Error('Lead must be approved/verified before transferring to Installation Team');
    }

    lead.transferredToInstallation = true;
    lead.status = 'in_process'; // Mark as in-process so superadmin can track it's with installation

    // Add remark entry
    lead.remarks.push({
      note: `[Accounts Team] Verified Lead transferred to Installation Team.`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead)
      }
    });
  } catch (error) {
    next(error);
  }
};
