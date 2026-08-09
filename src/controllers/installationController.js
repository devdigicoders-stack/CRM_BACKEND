import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
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
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.svg', '.webp', '.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp', '.m4v'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only image, video, and PDF files are allowed for installation proof'), false);
  }
};

export const uploadProofMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
}).single('proof');

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

    if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.installationRep = new mongoose.Types.ObjectId(String(req.user._id));
    } else {
      query.installationRep = { $exists: true, $ne: null };
    }

    const totalAssigned = await Lead.countDocuments(query);
    const inProgress = await Lead.countDocuments({ ...query, installationStatus: 'in_progress' });
    const completed = await Lead.countDocuments({ ...query, installationStatus: 'completed' });
    const issuesReported = await Lead.countDocuments({ ...query, installationIssueReported: true });

    res.status(200).json({
      status: 'success',
      data: { totalAssigned, inProgress, completed, issuesReported }
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

    if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.installationRep = new mongoose.Types.ObjectId(String(req.user._id));
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) query.installationStatus = status;
    if (issueReported) {
      if (issueReported === 'true') {
        query.installationIssueReported = true;
      } else if (issueReported === 'false') {
        query.installationIssueReported = false;
      } else if (issueReported === 'issue') {
        query.installationIssueReported = true;
        query.$or = [
          { installationIssueType: 'issue' },
          { installationIssueType: { $exists: false } },
          { installationIssueType: null }
        ];
      } else if (issueReported === 'delay') {
        query.installationIssueReported = true;
        query.installationIssueType = 'delay';
      }
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skipNum = (pageNum - 1) * limitNum;

    const total = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .populate('installationRep', 'name email role')
      .populate('assignedTo', 'name email role')
      .populate('productId')
      .sort({ createdAt: -1 })
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
      data: { leads: formattedLeads }
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

    if (!lead.transferredToInstallation) {
      res.status(400);
      throw new Error('Lead must be verified and transferred to Installation Team first');
    }

    const installerObjectId = new mongoose.Types.ObjectId(String(installerId));

    const updatedLead = await Lead.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          installationRep: installerObjectId,
          installationStatus: 'assigned',
          transferredToInstallation: true,
        },
        $push: {
          remarks: {
            note: `[System] Lead assigned to Installer: ${targetUser.name}`,
            addedBy: req.user._id,
            createdAt: new Date(),
          }
        }
      },
      { new: true, runValidators: true }
    );

    // Notify installer
    await sendNotification(
      installerId,
      '🔧 Installation Lead Assigned',
      `Lead "${updatedLead.name}" (${updatedLead.phone}) aapko assign ki gayi hai installation ke liye`,
      updatedLead._id
    );

    res.status(200).json({
      status: 'success',
      data: { lead: formatLeadWithIntegrations(updatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Manage/Update Installation Status
// @route   PUT /api/v1/installation/leads/:id/status
// @access  Private (Admins and Installers only)
export const updateInstallationStatus = async (req, res, next) => {
  try {
    const { status, progressRemarks, clearIssue, resolveIssue, clearInTransitRemark } = req.body;

    if (!status || !['assigned', 'in_progress', 'in_transit', 'completed'].includes(status.toLowerCase())) {
      res.status(400);
      throw new Error('Invalid installation status. Allowed: assigned, in_progress, in_transit, completed');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const repId = lead.installationRep?._id ? lead.installationRep._id.toString() : lead.installationRep?.toString();
    if (!['superAdmin', 'admin'].includes(req.user.role) && repId !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    const normalizedStatus = status.toLowerCase();
    if (normalizedStatus === 'completed' && (!lead.installationProofUrl || lead.installationProofUrl.trim() === '')) {
      res.status(400);
      throw new Error('Please upload an installation proof document/image before completing the installation');
    }
    lead.installationStatus = normalizedStatus;
    if (progressRemarks) {
      lead.installationProgressRemarks = progressRemarks;
      if (normalizedStatus === 'in_transit') {
        lead.inTransitRemarks = progressRemarks;
      }
    }

    // Clear in-transit remark if explicitly requested or if set to false/null
    if (clearInTransitRemark) {
      lead.inTransitRemarks = null;
    }

    // Clear active issue/delay if explicitly requested or setting to completed
    if (clearIssue || resolveIssue || normalizedStatus === 'completed') {
      lead.installationIssueReported = false;
      lead.installationIssueType = null;
      lead.installationIssueRemarks = '';
    }

    // Sync main lead status with installation status
    if (normalizedStatus === 'in_progress' || normalizedStatus === 'in_transit') lead.status = 'in_process';
    else if (normalizedStatus === 'completed') lead.status = 'closed';

    lead.remarks.push({
      note: `[Installation Team] Status updated to: ${normalizedStatus.toUpperCase()}. Progress/Transit Note: ${progressRemarks || 'None'}${clearIssue || resolveIssue ? ' (Issue/Delay cleared)' : ''}`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    // Notify on status changes
    if (normalizedStatus === 'in_progress') {
      const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
      for (const admin of admins) {
        await sendNotification(admin._id, '🔧 Installation In Progress', `Lead "${lead.name}" ki installation shuru ho gayi by ${req.user.name}`, lead._id);
      }
    } else if (normalizedStatus === 'completed') {
      const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
      for (const admin of admins) {
        await sendNotification(admin._id, '✅ Installation Completed', `Lead "${lead.name}" ki installation complete ho gayi by ${req.user.name}`, lead._id);
      }
      if (lead.assignedTo) {
        await sendNotification(lead.assignedTo, '✅ Installation Completed', `Lead "${lead.name}" ki installation complete ho gayi`, lead._id);
      }
    }

    res.status(200).json({
      status: 'success',
      data: { lead: formatLeadWithIntegrations(updatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload Installation Proof
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

    const repId = lead.installationRep?._id ? lead.installationRep._id.toString() : lead.installationRep?.toString();
    if (!['superAdmin', 'admin'].includes(req.user.role) && repId !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    lead.installationProofUrl = `/uploads/proofs/${req.file.filename}`;

    lead.remarks.push({
      note: `[Installation Team] Uploaded installation proof file: ${req.file.originalname}`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    // Notify admins and sales rep about proof upload
    const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
    for (const admin of admins) {
      await sendNotification(admin._id, '📸 Installation Proof Uploaded', `Lead "${lead.name}" ke liye installation proof upload hua by ${req.user.name}`, lead._id);
    }
    if (lead.assignedTo) {
      await sendNotification(lead.assignedTo, '📸 Installation Proof Uploaded', `Lead "${lead.name}" ke liye installation proof upload ho gaya`, lead._id);
    }

    res.status(200).json({
      status: 'success',
      data: { lead: formatLeadWithIntegrations(updatedLead) }
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
    const { issueRemarks, issueType } = req.body;

    if (!issueRemarks) {
      res.status(400);
      throw new Error('Please provide details/remarks of the reported issue or delay');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const repId = lead.installationRep?._id ? lead.installationRep._id.toString() : lead.installationRep?.toString();
    if (!['superAdmin', 'admin'].includes(req.user.role) && repId !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    const type = ['issue', 'delay'].includes(issueType?.toLowerCase()) ? issueType.toLowerCase() : 'issue';
    lead.installationIssueReported = true;
    lead.installationIssueType = type;
    lead.installationIssueRemarks = issueRemarks;
    lead.remarks.push({
      note: `[Installation Team] ${type === 'delay' ? '⏳ DELAY' : '🚨 ISSUE'} REPORTED: ${issueRemarks}`,
      addedBy: req.user._id
    });
    const updatedLead = await lead.save();

    // Notify admins about issue/delay
    const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
    for (const admin of admins) {
      await sendNotification(admin._id, type === 'delay' ? '⏳ Installation Delay Reported' : '🚨 Installation Issue Reported', `Lead "${lead.name}" mein ${type} report hua: ${issueRemarks}`, lead._id);
    }

    res.status(200).json({
      status: 'success',
      data: { lead: formatLeadWithIntegrations(updatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Resolve / Clear reported Issue or Delay
// @route   PUT /api/v1/installation/leads/:id/resolve-issue
// @access  Private (Admins and Installers only)
export const resolveInstallationIssue = async (req, res, next) => {
  try {
    const { resolutionRemarks } = req.body;

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const repId = lead.installationRep?._id ? lead.installationRep._id.toString() : lead.installationRep?.toString();
    if (!['superAdmin', 'admin'].includes(req.user.role) && repId !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    lead.installationIssueReported = false;
    lead.installationIssueType = null;
    const oldRemarks = lead.installationIssueRemarks;
    lead.installationIssueRemarks = '';

    lead.remarks.push({
      note: `[Installation Team] ✅ ISSUE/DELAY RESOLVED: ${resolutionRemarks || `Resolved active issue/delay (${oldRemarks || 'Flag cleared'})`}`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      data: { lead: formatLeadWithIntegrations(updatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete Installation Proof
// @route   DELETE /api/v1/installation/leads/:id/proof
// @access  Private (Admins and Installers only)
// @access  Private (Admins and Installers only)
export const deleteInstallationProof = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const repId = lead.installationRep?._id ? lead.installationRep._id.toString() : lead.installationRep?.toString();
    if (!['superAdmin', 'admin'].includes(req.user.role) && repId !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    if (!lead.installationProofUrl) {
      res.status(400);
      throw new Error('No installation proof uploaded for this lead');
    }

    // Attempt deleting physical file if stored locally
    if (lead.installationProofUrl.startsWith('/uploads/')) {
      const filePath = path.join('public', lead.installationProofUrl);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkErr) {
          console.error('Failed to delete physical proof file:', unlinkErr.message);
        }
      }
    }

    lead.installationProofUrl = null;
    lead.remarks.push({
      note: `[Installation Team] Deleted installation proof file`,
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      message: 'Installation proof deleted successfully',
      data: { lead: formatLeadWithIntegrations(updatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear / Remove In-Transit Remark
// @route   PUT /api/v1/installation/leads/:id/clear-transit-remark
// @access  Private (Admins and Installers only)
export const clearInTransitRemark = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    const repId = lead.installationRep?._id ? lead.installationRep._id.toString() : lead.installationRep?.toString();
    if (!['superAdmin', 'admin'].includes(req.user.role) && repId !== req.user._id.toString()) {
      res.status(403);
      throw new Error('You do not have permission to modify this installation');
    }

    lead.inTransitRemarks = null;
    lead.remarks.push({
      note: '[Installation Team] In-Transit remark cleared/removed',
      addedBy: req.user._id
    });

    const updatedLead = await lead.save();

    res.status(200).json({
      status: 'success',
      message: 'In-Transit remark removed successfully',
      data: { lead: formatLeadWithIntegrations(updatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

