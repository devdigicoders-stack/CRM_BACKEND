import multer from 'multer';
import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Admin } from '../models/Admin.js';
import { Notification } from '../models/Notification.js';
import { sendPushNotification } from '../config/firebase.js';

const sendNotification = async (recipientId, title, message, leadId) => {
  try {
    await Notification.create({ title, message, recipient: recipientId, lead: leadId, type: 'general' });
    let recipient = await User.findById(recipientId).select('fcmToken').lean();
    if (!recipient) recipient = await Admin.findById(recipientId).select('fcmToken').lean();
    if (recipient?.fcmToken) await sendPushNotification(recipient.fcmToken, title, message, { leadId: leadId?.toString() });
  } catch (err) {
    console.error('Notification error:', err.message);
  }
};

// Helper to format lead response with helper integration links
const formatLeadWithIntegrations = (lead) => {
  const leadObj = lead.toObject ? lead.toObject() : lead;

  // Clean phone number (leave only digits) for WhatsApp Link
  const cleanedPhone = leadObj.phone.replace(/\D/g, '');

  // Add country code if not present (assuming +91 for India as default if length is 10, or leave as is)
  const phoneWithCountry = cleanedPhone.length === 10 ? `91${cleanedPhone}` : cleanedPhone;

  return {
    ...leadObj,
    integrations: {
      whatsappLink: `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(`Hello ${leadObj.name}, `)}`,
      callUri: `tel:${leadObj.phone}`,
    },
  };
};

// @desc    Add a new lead
// @route   POST /api/v1/leads
// @access  Private
export const createLead = async (req, res, next) => {
  try {
    const { name, phone, email, source, status, priority, tags, assignedTo, followUpDate, remark } = req.body;

    if (!name || !phone) {
      res.status(400);
      throw new Error('Please provide lead name and phone number');
    }

    // Set assignedTo: if not provided and requester is a staff member, default to themselves.
    let finalAssignedTo = assignedTo;
    if (!finalAssignedTo && !['superAdmin', 'admin', 'crmuser'].includes(req.user.role)) {
      finalAssignedTo = req.user._id;
    }

    // Determine initial status: if has assignee, default to 'assigned' instead of 'new'
    const finalStatus = status || (finalAssignedTo ? 'assigned' : 'new');

    const creatorModel = ['superAdmin', 'admin'].includes(req.user.role) ? 'Admin' : 'User';

    // Build lead details
    const leadData = {
      name,
      phone,
      email,
      source,
      status: finalStatus,
      priority,
      tags,
      createdBy: req.user._id,
      createdByModel: creatorModel,
      followUpDate,
      remarks: [],
    };

    if (finalAssignedTo) {
      leadData.assignedTo = finalAssignedTo;
      // Determine if assignee is Admin or User
      let targetUser = await User.findById(finalAssignedTo);
      let assigneeModel = 'User';
      if (!targetUser) {
        targetUser = await Admin.findById(finalAssignedTo);
        if (targetUser) assigneeModel = 'Admin';
      }
      leadData.assignedToModel = assigneeModel;
      leadData.assignedBy = req.user._id;
      leadData.assignedByModel = creatorModel;
    }

    // If an initial remark is provided, add it
    if (remark) {
      leadData.remarks.push({
        note: remark,
        addedBy: req.user._id,
      });
    }

    const lead = await Lead.create(leadData);

    // Notify assignee if lead is directly assigned on creation
    if (finalAssignedTo) {
      await sendNotification(finalAssignedTo, '📋 New Lead Assigned', `Lead "${lead.name}" (${lead.phone}) aapko assign ki gayi hai by ${req.user.name}`, lead._id);
    }

    res.status(201).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(lead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if a phone number already exists in leads
// @route   GET /api/v1/leads/check-phone
// @access  Private
export const checkPhoneExists = async (req, res, next) => {
  try {
    const { phone } = req.query;

    if (!phone) {
      res.status(400);
      throw new Error('Please provide a phone number');
    }

    const cleanPhone = phone.replace(/\D/g, '');
    let query = { phone: phone.trim() };

    if (cleanPhone.length >= 10) {
      const last10 = cleanPhone.slice(-10);
      query = {
        $or: [
          { phone: phone.trim() },
          { phone: { $regex: last10 + '$' } }
        ]
      };
    }

    const lead = await Lead.findOne(query)
      .populate('assignedTo', 'name email role')
      .lean();

    if (!lead) {
      return res.status(200).json({
        status: 'success',
        exists: false,
      });
    }

    res.status(200).json({
      status: 'success',
      exists: true,
      lead: {
        _id: lead._id,
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        assignedTo: lead.assignedTo ? {
          _id: lead.assignedTo._id,
          name: lead.assignedTo.name,
          role: lead.assignedTo.role,
        } : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    View leads (Search, Filter, List)
// @route   GET /api/v1/leads
// @access  Private
export const getLeads = async (req, res, next) => {
  try {
    const { search, status, priority, tag, assignedTo, followUpDate, page = 1, limit } = req.query;

    const query = {};

    // 1) Security constraint
    if (['superAdmin', 'admin'].includes(req.user.role)) {
      if (assignedTo) query.assignedTo = assignedTo;
    } else if (req.user.role === 'crmuser') {
      // crmuser can see leads they created OR leads assigned to them
      query.$or = [
        { createdBy: req.user._id },
        { assignedTo: req.user._id },
      ];
    } else {
      query.assignedTo = req.user._id;
    }

    // 2) Search parameter (matches name, phone, or email via regex)
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // 3) Filters
    if (status) {
      query.status = status;
    }
    if (priority) {
      query.priority = priority;
    }
    if (tag) {
      query.tags = tag; // MongoDB handles matching element in array automatically
    }

    // 4) Follow up date filter
    if (followUpDate) {
      // Match exact day range (00:00:00 to 23:59:59)
      const startOfDay = new Date(followUpDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(followUpDate);
      endOfDay.setHours(23, 59, 59, 999);

      query.followUpDate = {
        $gte: startOfDay,
        $lte: endOfDay,
      };
    }

    const pageNum = parseInt(page, 10) || 1;

    // Get total count
    const total = await Lead.countDocuments(query);
    let limitNum = total;

    // Execute query sorted by latest updated lead
    let queryBuilder = Lead.find(query)
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name email')
      .populate('assignedBy', 'name email role')
      .sort({ updatedAt: -1 });

    if (limit !== undefined) {
      const parsedLimit = parseInt(limit, 10);
      if (!isNaN(parsedLimit)) {
        limitNum = parsedLimit;
        const skipNum = (pageNum - 1) * limitNum;
        queryBuilder = queryBuilder.skip(skipNum).limit(limitNum);
      }
    }

    const leads = await queryBuilder.lean();

    const formattedLeads = leads.map(formatLeadWithIntegrations);

    res.status(200).json({
      status: 'success',
      results: formattedLeads.length,
      total,
      pages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      data: {
        leads: formattedLeads,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get details of a single lead
// @route   GET /api/v1/leads/:id
// @access  Private
export const getLeadById = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email')
      .populate('assignedBy', 'name email role phone')
      .populate('remarks.addedBy', 'name email role');

    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const userId = req.user._id.toString();
    const createdById = lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString();
    const assignedId = lead.assignedTo?._id ? lead.assignedTo._id.toString() : lead.assignedTo?.toString();
    const installationRepId = lead.installationRep?._id ? lead.installationRep._id.toString() : lead.installationRep?.toString();
    const hasAccess =
      ['superAdmin', 'admin'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (createdById === userId || assignedId === userId)) ||
      (req.user.role === 'accountant' && lead.transferredToAccounts === true) ||
      (req.user.role === 'installation' && installationRepId === userId) ||
      assignedId === userId;

    if (!hasAccess) {
      res.status(403);
      throw new Error('You do not have permission to access this lead');
    }

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(lead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update lead details (name, email, phone, priority, tags)
// @route   PUT /api/v1/leads/:id
// @access  Private
export const updateLead = async (req, res, next) => {
  try {
    const { name, phone, email, priority, tags, status, isCallDone } = req.body;

    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canUpdate =
      ['superAdmin', 'admin', 'sales'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canUpdate) {
      res.status(403);
      throw new Error('You do not have permission to update this lead');
    }

    // Update fields if provided
    if (name) lead.name = name;
    if (phone) lead.phone = phone;
    if (email) lead.email = email;
    if (priority) lead.priority = priority;
    if (tags) lead.tags = tags;
    if (isCallDone !== undefined) lead.isCallDone = isCallDone;
    if (status) {
      if (status === 'converted' && lead.status !== 'converted') {
        lead.transferredToAccounts = true;
        lead.saleConfirmedAt = new Date();
        lead.remarks.push({
          note: `[System] Lead automatically marked as Sale Confirmed (Closed Won) and transferred to Accounts Team.`,
          addedBy: req.user._id
        });

        // Notify all admins about new sale
        const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
        for (const admin of admins) {
          sendNotification(admin._id, '💰 New Sale Confirmed (Auto)', `Lead "${lead.name}" ki sale confirm ho gayi aur accounts team ko auto-transfer ho gayi by ${req.user.name}`, lead._id).catch(err => console.error(err));
        }
      }
      lead.status = status;
    }

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Assign a lead to a sales panel / user
// @route   PUT /api/v1/leads/:id/assign
// @access  Private (Managers only, or Sales Reps setting it to themselves/others if authorized. We'll restrict to managers as per standard CRM flows, but allow self-assignment for ease)
export const assignLead = async (req, res, next) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      res.status(400);
      throw new Error('Please provide user ID to assign this lead to');
    }

    // Verify target user exists (check both User and Admin collections)
    let targetUser = await User.findById(userId);
    let assigneeModel = 'User';
    if (!targetUser) {
      const { Admin } = await import('../models/Admin.js');
      targetUser = await Admin.findById(userId);
      if (targetUser) assigneeModel = 'Admin';
    }
    if (!targetUser) {
      res.status(404);
      throw new Error('User to assign lead to not found');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canAssign =
      ['superAdmin', 'admin', 'sales'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canAssign) {
      res.status(403);
      throw new Error('You do not have permission to assign this lead');
    }

    // calling rep can only assign to sales, crmuser can assign to anyone
    if (req.user.role === 'calling' && targetUser.role !== 'sales') {
      res.status(400);
      throw new Error('Calling representatives can only assign leads to the Sales Panel representatives');
    }

    // Update assignment
    lead.assignedTo = userId;
    lead.assignedToModel = assigneeModel;
    lead.assignedBy = req.user._id;
    lead.assignedByModel = ['superAdmin', 'admin'].includes(req.user.role) ? 'Admin' : 'User';
    lead.status = 'assigned';

    // If assigning to installation role, set installation fields too
    if (targetUser.role === 'installation') {
      lead.installationRep = userId;
      lead.transferredToInstallation = true;
      lead.installationStatus = 'assigned';
    }

    // Add audit remark
    lead.remarks.push({
      note: `[Reassignment] Lead assigned to ${targetUser.name} (${targetUser.role}) by ${req.user.name}`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    // Send assignment notification
    await sendNotification(userId, '📋 New Lead Assigned', `Lead "${updatedLead.name}" (${updatedLead.phone}) aapko assign ki gayi hai by ${req.user.name}`, updatedLead._id);

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add remark, set next follow-up date, and update details (tags, priority, status)
// @route   POST /api/v1/leads/:id/remarks
// @access  Private
export const addRemark = async (req, res, next) => {
  try {
    const { note, followUpDate, visitDate, tags, priority, status } = req.body;

    if (!note) {
      res.status(400);
      throw new Error('Please provide remark note');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canRemark =
      ['superAdmin', 'admin', 'sales'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canRemark) {
      res.status(403);
      throw new Error('You do not have permission to add remarks to this lead');
    }

    // Add remark object
    lead.remarks.push({
      note,
      addedBy: req.user._id,
    });

    // Update secondary details if provided in request
    if (followUpDate !== undefined) {
      lead.followUpDate = followUpDate ? new Date(followUpDate) : null;
    }
    if (visitDate !== undefined) {
      lead.visitDate = visitDate ? new Date(visitDate) : null;
    }
    if (tags) {
      lead.tags = tags;
    }
    if (priority) {
      lead.priority = priority;
    }
    if (status) {
      if (status === 'converted' && lead.status !== 'converted') {
        lead.transferredToAccounts = true;
        lead.saleConfirmedAt = new Date();
        lead.remarks.push({
          note: `[System] Lead automatically marked as Sale Confirmed (Closed Won) and transferred to Accounts Team.`,
          addedBy: req.user._id
        });

        // Notify all admins about new sale
        const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
        for (const admin of admins) {
          sendNotification(admin._id, '💰 New Sale Confirmed (Auto)', `Lead "${lead.name}" ki sale confirm ho gayi aur accounts team ko auto-transfer ho gayi by ${req.user.name}`, lead._id).catch(err => console.error(err));
        }
      }
      lead.status = status;
    }

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Configure multer storage for agreements/sale documents
const agreementStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/agreements';
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

const agreementFileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, Word documents, and images are allowed for agreements'), false);
  }
};

export const uploadAgreementMiddleware = multer({
  storage: agreementStorage,
  fileFilter: agreementFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
}).single('agreement');

// Configure multer storage for payment screenshots
const paymentScreenshotStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/payments';
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

const paymentScreenshotFileFilter = (req, file, cb) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only images and PDFs are allowed for payment screenshots'), false);
  }
};

export const uploadPaymentScreenshotMiddleware = multer({
  storage: paymentScreenshotStorage,
  fileFilter: paymentScreenshotFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
}).single('paymentScreenshot');

// @desc    Update Product / Service Details and Deal Value / Sale Amount
// @route   PUT /api/v1/leads/:id/sale-details
// @access  Private
export const updateSaleDetails = async (req, res, next) => {
  try {
    const { productDetails, dealValue } = req.body;

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canModifySale =
      ['superAdmin', 'admin', 'sales'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canModifySale) {
      res.status(403);
      throw new Error('You do not have permission to modify this lead');
    }

    if (productDetails) lead.productDetails = productDetails;
    if (dealValue !== undefined) lead.dealValue = dealValue;

    // Add remark entry
    lead.remarks.push({
      note: `[Sales Rep] Updated Sale Details (Product: ${productDetails || 'N/A'}, Deal Value: ${dealValue !== undefined ? dealValue : 'N/A'})`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    // Notify admins about sale details update
    const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
    for (const admin of admins) {
      await sendNotification(admin._id, '💰 Sale Details Updated', `Lead "${lead.name}" ke sale details update hue (Product: ${productDetails || 'N/A'}, Deal Value: ${dealValue !== undefined ? dealValue : 'N/A'}) by ${req.user.name}`, lead._id);
    }

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload Sale Documents / Agreement
// @route   PUT /api/v1/leads/:id/sale-documents
// @access  Private
export const uploadSaleDocuments = async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('Please upload an agreement document');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canUploadDoc =
      ['superAdmin', 'admin', 'sales'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canUploadDoc) {
      res.status(403);
      throw new Error('You do not have permission to modify this lead');
    }

    const relativePath = `/uploads/agreements/${req.file.filename}`;
    lead.saleDocumentsUrl = relativePath;

    // Add remark entry
    lead.remarks.push({
      note: `[Sales Rep] Uploaded sale documents / agreement: ${req.file.originalname}`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    // Notify admins about uploaded sale document
    const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
    for (const admin of admins) {
      await sendNotification(admin._id, '📄 Sale Document Uploaded', `Lead "${lead.name}" ke liye sale document upload hua by ${req.user.name}`, lead._id);
    }

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Transfer Closed Won Lead to Accounts Team
// @route   PUT /api/v1/leads/:id/transfer-to-accounts
// @access  Private
export const transferToAccounts = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canTransfer =
      ['superAdmin', 'admin', 'sales'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canTransfer) {
      res.status(403);
      throw new Error('You do not have permission to modify this lead');
    }

    // Set status to converted and transferredToAccounts to true
    lead.status = 'converted';
    lead.transferredToAccounts = true;
    lead.saleConfirmedAt = new Date();
    if (req.body.dealValue !== undefined) lead.dealValue = req.body.dealValue;

    // Add remark entry
    lead.remarks.push({
      note: `[Sales Rep] Mark Lead as Sale Confirmed (Closed Won) and transferred to Accounts Team.`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    // Notify all admins about new sale
    const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
    for (const admin of admins) {
      await sendNotification(admin._id, '💰 New Sale Confirmed', `Lead "${lead.name}" ki sale confirm ho gayi aur accounts team ko transfer ho gayi by ${req.user.name}`, lead._id);
    }

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const confirmSale = async (req, res, next) => {
  try {
    const { productDetails, accountRemarks } = req.body;
    const transferToAccounts = req.body.transferToAccounts === 'true' || req.body.transferToAccounts === true;
    const dealValue = req.body.dealValue !== undefined ? Number(req.body.dealValue) : undefined;
    const amountPaid = req.body.amountPaid !== undefined ? Number(req.body.amountPaid) : undefined;
    const pendingAmount = req.body.pendingAmount !== undefined ? Number(req.body.pendingAmount) : undefined;

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canConfirm =
      ['superAdmin', 'admin', 'sales'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canConfirm) {
      res.status(403);
      throw new Error('You do not have permission to confirm sale for this lead');
    }

    // Validation
    if (!productDetails || !productDetails.trim()) {
      res.status(400);
      throw new Error('Product details are required');
    }
    if (dealValue === undefined || isNaN(dealValue)) {
      res.status(400);
      throw new Error('Deal value is required and must be a number');
    }
    if (amountPaid === undefined || isNaN(amountPaid)) {
      res.status(400);
      throw new Error('Amount paid is required and must be a number');
    }
    if (pendingAmount === undefined || isNaN(pendingAmount)) {
      res.status(400);
      throw new Error('Pending amount is required and must be a number');
    }
    if (!req.file && !lead.paymentScreenshot) {
      res.status(400);
      throw new Error('Payment screenshot is required');
    }

    lead.productDetails = productDetails;
    lead.dealValue = dealValue;
    lead.amountPaid = amountPaid;
    lead.pendingAmount = pendingAmount;
    if (accountRemarks) lead.accountRemarks = accountRemarks;

    if (req.file) {
      lead.paymentScreenshot = `/uploads/payments/${req.file.filename}`;
    }

    // Set status to converted (Closed Won)
    lead.status = 'converted';

    let remarkNote = `[Sales Rep] Mark Lead as Sale Confirmed (Closed Won).`;

    if (transferToAccounts === true) {
      lead.transferredToAccounts = true;
      lead.saleConfirmedAt = new Date();
      remarkNote += ` Transferred to Accounts Team. Remarks: ${accountRemarks || 'None'}`;

      // Notify all admins about new sale
      const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
      for (const admin of admins) {
        await sendNotification(
          admin._id,
          '💰 New Sale Confirmed',
          `Lead "${lead.name}" ki sale confirm ho gayi aur accounts team ko transfer ho gayi by ${req.user.name}`,
          lead._id
        ).catch(err => console.error(err));
      }
    } else {
      remarkNote += ` Remarks: ${accountRemarks || 'None'}`;
    }

    lead.remarks.push({
      note: remarkNote,
      addedBy: req.user._id,
    });

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update Delivery Status (Pending / In Progress / Delivered) & Timeline
// @route   PUT /api/v1/leads/:id/delivery
// @access  Private
export const updateDeliveryStatus = async (req, res, next) => {
  try {
    const { deliveryStatus, expectedDeliveryDate } = req.body;

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canUpdateDelivery =
      ['superAdmin', 'admin', 'sales'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canUpdateDelivery) {
      res.status(403);
      throw new Error('You do not have permission to modify this lead');
    }

    if (deliveryStatus) {
      if (!['pending', 'in_progress', 'delivered'].includes(deliveryStatus.toLowerCase())) {
        res.status(400);
        throw new Error('Invalid deliveryStatus. Allowed: pending, in_progress, delivered');
      }
      lead.deliveryStatus = deliveryStatus.toLowerCase();
    }

    if (expectedDeliveryDate) {
      lead.expectedDeliveryDate = new Date(expectedDeliveryDate);
    }

    // Add remark entry
    lead.remarks.push({
      note: `[Sales Rep] Updated Delivery Status (Status: ${lead.deliveryStatus || 'N/A'}, Expected Delivery: ${lead.expectedDeliveryDate ? lead.expectedDeliveryDate.toISOString().split('T')[0] : 'N/A'})`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    // Notify admins about delivery status update
    if (deliveryStatus) {
      const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
      for (const admin of admins) {
        await sendNotification(admin._id, '📦 Delivery Status Updated', `Lead "${lead.name}" ka delivery status: ${lead.deliveryStatus.toUpperCase()} by ${req.user.name}`, lead._id);
      }
    }

    res.status(200).json({
      status: 'success',
      data: {
        lead: formatLeadWithIntegrations(updatedLead),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Configure multer storage for bulk Excel upload
const bulkUploadStorage = multer.memoryStorage();
export const uploadBulkMiddleware = multer({
  storage: bulkUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
}).single('file');

// @desc    Upload leads in bulk via Excel
// @route   POST /api/v1/leads/bulk-upload
// @access  Private
export const bulkUploadLeads = async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('Please upload an Excel file');
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!data || data.length === 0) {
      res.status(400);
      throw new Error('The uploaded Excel file is empty');
    }

    const creatorModel = ['superAdmin', 'admin'].includes(req.user.role) ? 'Admin' : 'User';

    const allUsers = await User.find({}).select('_id email').lean();
    const allAdmins = await Admin.find({}).select('_id email').lean();
    const emailToIdMap = {};
    const idToModelMap = {};

    allUsers.forEach(u => {
      if (u.email) {
        emailToIdMap[u.email.toLowerCase()] = u._id;
        idToModelMap[u._id.toString()] = 'User';
      }
    });
    allAdmins.forEach(a => {
      if (a.email) {
        emailToIdMap[a.email.toLowerCase()] = a._id;
        idToModelMap[a._id.toString()] = 'Admin';
      }
    });

    // ── Step 1: Parse all rows ────────────────────────────────────────
    const parsedRows = data.map((row) => {
      const cleanRow = {};
      Object.keys(row).forEach(key => {
        cleanRow[key.trim().toLowerCase()] = row[key];
      });
      const rawPhone = cleanRow['phone'] ? String(cleanRow['phone']).trim() : '';
      const digitsOnly = rawPhone.replace(/\D/g, '');
      // Always store last 10 digits (strips country code like +91)
      const normalized = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;
      return { cleanRow, rawPhone, normalized };
    });

    // ── Step 2: Separate invalid phone rows (not exactly 10 digits) ───
    const invalidRows = [];
    const validRows = [];

    for (const row of parsedRows) {
      if (row.normalized.length !== 10) {
        invalidRows.push({
          rowName: row.cleanRow['name'] || 'Unknown',
          phone: row.rawPhone || '(empty)',
          reason: row.rawPhone
            ? `${row.normalized.length} digit(s) found — must be exactly 10`
            : 'Phone number is missing',
        });
      } else {
        validRows.push({ ...row, last10: row.normalized });
      }
    }

    // ── Step 3: Bulk duplicate check against DB in one query ──────────
    const last10Phones = [...new Set(validRows.map(r => r.last10))];
    const existingLeads = last10Phones.length > 0
      ? await Lead.find({
        $or: last10Phones.map(p => ({ phone: { $regex: p + '$' } }))
      }).select('name phone status assignedTo').populate('assignedTo', 'name').lean()
      : [];

    const existingPhoneSet = new Set(
      existingLeads.map(l => l.phone.replace(/\D/g, '').slice(-10))
    );

    // ── Step 4: Separate new vs duplicate rows ────────────────────────
    const leadsToInsert = [];
    const duplicateDetails = [];

    for (const { cleanRow, last10 } of validRows) {
      const isDuplicate = existingPhoneSet.has(last10);

      if (isDuplicate) {
        const existingLead = existingLeads.find(
          l => l.phone.replace(/\D/g, '').slice(-10) === last10
        );
        duplicateDetails.push({
          rowName: cleanRow['name'] || 'Unknown',
          phone: last10,
          existingLeadName: existingLead?.name || 'Unknown',
          existingStatus: existingLead?.status || 'unknown',
          existingAssignedTo: existingLead?.assignedTo?.name || null,
        });
        continue;
      }

      let finalStatus = cleanRow['status'] ? cleanRow['status'].toLowerCase() : 'new';
      let finalAssignedTo = undefined;
      let finalAssignedToModel = undefined;

      const assignedToVal = cleanRow['assignedto'];
      if (assignedToVal) {
        const valStr = String(assignedToVal).trim().toLowerCase();
        if (emailToIdMap[valStr]) {
          finalAssignedTo = emailToIdMap[valStr];
          finalAssignedToModel = idToModelMap[finalAssignedTo.toString()];
          if (finalStatus === 'new') finalStatus = 'assigned';
        } else if (valStr.length === 24) {
          finalAssignedTo = valStr;
          finalAssignedToModel = 'User';
          if (finalStatus === 'new') finalStatus = 'assigned';
        }
      }

      const leadDoc = {
        name: cleanRow['name'] || 'Unknown',
        phone: last10,   // always store clean 10-digit number
        email: cleanRow['email'] || '',
        source: cleanRow['source'] || 'Bulk Upload',
        status: finalStatus,
        priority: cleanRow['priority'] ? cleanRow['priority'].toLowerCase() : 'medium',
        tags: cleanRow['tags'] ? String(cleanRow['tags']).split(',').map(t => t.trim()) : [],
        createdBy: req.user._id,
        createdByModel: creatorModel,
        remarks: cleanRow['remark'] ? [{ note: cleanRow['remark'], addedBy: req.user._id }] : [],
      };

      if (finalAssignedTo) {
        leadDoc.assignedTo = finalAssignedTo;
        leadDoc.assignedToModel = finalAssignedToModel;
        leadDoc.assignedBy = req.user._id;
        leadDoc.assignedByModel = creatorModel;
      }

      leadsToInsert.push(leadDoc);
    }

    // ── Step 5: Insert only valid, non-duplicate leads ────────────────
    let insertedCount = 0;
    if (leadsToInsert.length > 0) {
      const result = await Lead.insertMany(leadsToInsert);
      insertedCount = result.length;
    }

    // ── Step 6: Notify admins ─────────────────────────────────────────
    if (insertedCount > 0) {
      const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
      for (const admin of admins) {
        await sendNotification(
          admin._id,
          '📊 Bulk Leads Uploaded',
          `${insertedCount} leads inserted by ${req.user.name}. ${duplicateDetails.length} duplicates & ${invalidRows.length} invalid numbers skipped.`,
          null
        );
      }
    }

    res.status(201).json({
      status: 'success',
      message: `${insertedCount} inserted, ${duplicateDetails.length} duplicates skipped, ${invalidRows.length} invalid numbers skipped.`,
      data: {
        inserted: insertedCount,
        duplicatesCount: duplicateDetails.length,
        duplicates: duplicateDetails,
        invalidCount: invalidRows.length,
        invalid: invalidRows,
      }
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Delete a lead
// @route   DELETE /api/v1/leads/:id
// @access  Private (Super Admin only)
export const deleteLead = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Only allow superAdmin to delete leads
    if (req.user.role !== 'superAdmin') {
      res.status(403);
      throw new Error('Only Super Admin can delete leads');
    }

    await lead.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};
