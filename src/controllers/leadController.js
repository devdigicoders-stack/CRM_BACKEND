import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';

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

    // Build lead details
    const leadData = {
      name,
      phone,
      email,
      source,
      status: finalStatus,
      priority,
      tags,
      assignedTo: finalAssignedTo || undefined,
      createdBy: req.user._id,
      followUpDate,
      remarks: [],
    };

    // If an initial remark is provided, add it
    if (remark) {
      leadData.remarks.push({
        note: remark,
        addedBy: req.user._id,
      });
    }

    const lead = await Lead.create(leadData);

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

// @desc    View leads (Search, Filter, List)
// @route   GET /api/v1/leads
// @access  Private
export const getLeads = async (req, res, next) => {
  try {
    const { search, status, priority, tag, assignedTo, followUpDate, page = 1, limit = 20 } = req.query;

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

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skipNum = (pageNum - 1) * limitNum;

    // Get total count
    const total = await Lead.countDocuments(query);

    // Execute query sorted by latest updated lead
    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name email')
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
    const { name, phone, email, priority, tags, status } = req.body;

    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const canUpdate =
      ['superAdmin', 'admin'].includes(req.user.role) ||
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
    if (status) lead.status = status;

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
    if (!targetUser) {
      const { Admin } = await import('../models/Admin.js');
      targetUser = await Admin.findById(userId);
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
      ['superAdmin', 'admin'].includes(req.user.role) ||
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
    try {
      const { createNotificationAndSendPush } = await import('./notificationController.js');
      await createNotificationAndSendPush({
        recipientId: userId,
        title: '📋 New Lead Assigned',
        message: `You have been assigned a new lead: "${updatedLead.name}".`,
        leadId: updatedLead._id,
        type: 'general',
      });
    } catch (err) {
      console.error('Failed to send lead assignment notification:', err.message);
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

// @desc    Add remark, set next follow-up date, and update details (tags, priority, status)
// @route   POST /api/v1/leads/:id/remarks
// @access  Private
export const addRemark = async (req, res, next) => {
  try {
    const { note, followUpDate, tags, priority, status } = req.body;

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
      ['superAdmin', 'admin'].includes(req.user.role) ||
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
    if (tags) {
      lead.tags = tags;
    }
    if (priority) {
      lead.priority = priority;
    }
    if (status) {
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
      ['superAdmin', 'admin'].includes(req.user.role) ||
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
      ['superAdmin', 'admin'].includes(req.user.role) ||
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
      ['superAdmin', 'admin'].includes(req.user.role) ||
      (req.user.role === 'crmuser' && (lead.createdBy?._id ? lead.createdBy._id.toString() : lead.createdBy?.toString()) === req.user._id.toString()) ||
      lead.assignedTo?.toString() === req.user._id.toString();
    if (!canTransfer) {
      res.status(403);
      throw new Error('You do not have permission to modify this lead');
    }

    // Set status to converted and transferredToAccounts to true
    lead.status = 'converted';
    lead.transferredToAccounts = true;

    // Add remark entry
    lead.remarks.push({
      note: `[Sales Rep] Mark Lead as Sale Confirmed (Closed Won) and transferred to Accounts Team.`,
      addedBy: req.user._id
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
      ['superAdmin', 'admin'].includes(req.user.role) ||
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
