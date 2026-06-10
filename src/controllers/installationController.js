import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';

// Configure multer storage for installation proofs
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/proofs';
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
    cb(new Error('Only PDF and image files are allowed for installation proof'), false);
  }
};

export const uploadProofMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
}).single('proof');

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

// @desc    Get installer dashboard statistics overview
// @route   GET /api/v1/installation/dashboard
// @access  Private (Admins and Installers only)
export const getInstallationDashboard = async (req, res, next) => {
  try {
    const query = { transferredToInstallation: true };

    // Limit to the logged-in installer if not an admin
    if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.installationRep = req.user._id;
    } else {
      query.installationRep = { $exists: true, $ne: null };
    }

    const totalAssigned = await Lead.countDocuments(query);
    
    const inProgress = await Lead.countDocuments({
      ...query,
      installationStatus: 'in_progress'
    });

    const completed = await Lead.countDocuments({
      ...query,
      installationStatus: 'completed'
    });

    const issuesReported = await Lead.countDocuments({
      ...query,
      installationIssueReported: true
    });

    res.status(200).json({
      status: 'success',
      data: {
        totalAssigned,
        inProgress,
        completed,
        issuesReported
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    View assigned verified leads
// @route   GET /api/v1/installation/leads
// @access  Private (Admins and Installers only)
export const getAssignedInstallationLeads = async (req, res, next) => {
  try {
    const { search, status, issueReported, page = 1, limit = 20 } = req.query;

    const query = { transferredToInstallation: true };

    // Limit to the logged-in installer if not an admin
    if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.installationRep = req.user._id;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) {
      query.installationStatus = status;
    }

    if (issueReported) {
      query.installationIssueReported = issueReported === 'true';
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skipNum = (pageNum - 1) * limitNum;

    const total = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .populate('installationRep', 'name email role')
      .populate('assignedTo', 'name email role')
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

// @desc    Assign an installation rep to a verified lead
// @route   PUT /api/v1/installation/leads/:id/assign-rep
// @access  Private (Admins and Accountants only)
export const assignInstallationRep = async (req, res, next) => {
  try {
    const { installerId } = req.body;

    if (!installerId) {
      res.status(400);
      throw new Error('Please provide installerId to assign this lead to');
    }

    // Verify installer user exists and is an installation rep
    const targetUser = await User.findById(installerId);
    if (!targetUser) {
      res.status(404);
      throw new Error('Installation user not found');
    }

    if (targetUser.role !== 'installation') {
      res.status(400);
      throw new Error('Assigned user must be in the installation team role');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Must be transferred to installation first
    if (!lead.transferredToInstallation) {
      res.status(400);
      throw new Error('Lead must be verified and transferred to Installation Team first');
    }

    lead.installationRep = installerId;
    lead.installationStatus = 'assigned'; // Reset to assigned on new assignment

    // Add remark entry
    lead.remarks.push({
      note: `[System] Lead assigned to Installer: ${targetUser.name}`,
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

// @desc    Manage/Update Installation Status (Assigned / In Progress / Completed)
// @route   PUT /api/v1/installation/leads/:id/status
// @access  Private (Admins and Installers only)
export const updateInstallationStatus = async (req, res, next) => {
  try {
    const { status, progressRemarks } = req.body;

    if (!status || !['assigned', 'in_progress', 'completed'].includes(status.toLowerCase())) {
      res.status(400);
      throw new Error('Invalid installation status. Allowed: assigned, in_progress, completed');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Access check: installers can only modify their own assigned installations
    if (!['superAdmin', 'admin'].includes(req.user.role) && lead.installationRep?.toString() !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    lead.installationStatus = status.toLowerCase();
    if (progressRemarks) {
      lead.installationProgressRemarks = progressRemarks;
    }

    // Add remark entry
    lead.remarks.push({
      note: `[Installation Team] Status updated to: ${status.toUpperCase()}. Progress: ${progressRemarks || 'None'}`,
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

// @desc    Upload Installation Proof (Image / Document)
// @route   PUT /api/v1/installation/leads/:id/proof
// @access  Private (Admins and Installers only)
export const uploadInstallationProof = async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('Please upload an installation proof document/image');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Access check
    if (!['superAdmin', 'admin'].includes(req.user.role) && lead.installationRep?.toString() !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    const relativePath = `/uploads/proofs/${req.file.filename}`;
    lead.installationProofUrl = relativePath;

    // Add remark entry
    lead.remarks.push({
      note: `[Installation Team] Uploaded installation proof file: ${req.file.originalname}`,
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

// @desc    Report Issues / Delays
// @route   PUT /api/v1/installation/leads/:id/issue
// @access  Private (Admins and Installers only)
export const reportInstallationIssue = async (req, res, next) => {
  try {
    const { issueRemarks } = req.body;

    if (!issueRemarks) {
      res.status(400);
      throw new Error('Please provide details/remarks of the reported issue or delay');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Access check
    if (!['superAdmin', 'admin'].includes(req.user.role) && lead.installationRep?.toString() !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    lead.installationIssueReported = true;
    lead.installationIssueRemarks = issueRemarks;

    // Add remark entry
    lead.remarks.push({
      note: `[Installation Team] 🚨 ISSUE/DELAY REPORTED: ${issueRemarks}`,
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
