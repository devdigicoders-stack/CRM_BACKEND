import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Admin } from '../models/Admin.js';
import { Product } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/invoices';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
  if (allowedExtensions.includes(path.extname(file.originalname).toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF and image files are allowed for invoice'), false);
  }
};

export const uploadInvoiceMiddleware = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } }).single('invoice');

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

const statsKeyExists = (key, obj) => Object.prototype.hasOwnProperty.call(obj, key);

export const getAccountDashboard = async (req, res, next) => {
  try {
    const totalClosedWon = await Lead.countDocuments({ transferredToAccounts: true, status: { $in: ['converted', 'closed'] } });
    const pendingVerification = await Lead.countDocuments({ transferredToAccounts: true, status: { $in: ['converted', 'closed'] }, verificationStatus: 'pending' });
    const verifiedSales = await Lead.countDocuments({ transferredToAccounts: true, status: { $in: ['converted', 'closed'] }, verificationStatus: 'verified' });
    const rejectedSales = await Lead.countDocuments({ verificationStatus: 'rejected' });
    const paymentStatusBreakdown = await Lead.aggregate([
      { $match: { transferredToAccounts: true, status: { $in: ['converted', 'closed'] } } },
      { $group: { _id: '$paymentStatus', count: { $sum: 1 } } }
    ]);
    const paymentStats = { pending: 0, partial: 0, completed: 0 };
    paymentStatusBreakdown.forEach((item) => {
      if (item._id && statsKeyExists(item._id, paymentStats)) paymentStats[item._id] = item.count;
    });
    res.status(200).json({ status: 'success', data: { totalClosedWon, pendingVerification, verifiedSales, rejectedSales, paymentStatusBreakdown: paymentStats } });
  } catch (error) {
    next(error);
  }
};

export const getClosedWonLeads = async (req, res, next) => {
  try {
    const { search, verificationStatus, paymentStatus, page = 1, limit = 20 } = req.query;
    
    // Base query logic: if rejected, it's no longer transferredToAccounts
    const query = {};
    if (verificationStatus === 'rejected') {
      query.verificationStatus = 'rejected';
    } else {
      query.transferredToAccounts = true;
      query.status = { $in: ['converted', 'closed'] };
      if (verificationStatus) query.verificationStatus = verificationStatus;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (paymentStatus) query.paymentStatus = paymentStatus;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skipNum = (pageNum - 1) * limitNum;
    const total = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role')
      .populate('remarks.addedBy', 'name email role')
      .populate('productId')
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();
    res.status(200).json({ status: 'success', results: leads.length, total, pages: Math.ceil(total / limitNum), currentPage: pageNum, data: { leads: leads.map(formatLeadWithIntegrations) } });
  } catch (error) {
    next(error);
  }
};

export const verifySale = async (req, res, next) => {
  try {
    const { verificationStatus, remarks } = req.body;
    if (!verificationStatus || !['verified', 'rejected'].includes(verificationStatus)) {
      res.status(400);
      throw new Error('Please provide a valid verificationStatus (verified or rejected)');
    }
    const lead = await Lead.findById(req.params.id);
    if (!lead) { res.status(404); throw new Error('Lead not found'); }
    if (verificationStatus === 'verified' && !['converted', 'closed'].includes(lead.status)) {
      res.status(400);
      throw new Error('Only closed won (converted/closed) sales can be verified');
    }
    lead.verificationStatus = verificationStatus;
    if (remarks) lead.accountRemarks = remarks;
    lead.remarks.push({
      note: `[Accounts Team] Sale ${verificationStatus === 'verified' ? 'Approved & Verified' : 'Rejected'}. Remarks: ${remarks || 'None'}`,
      addedBy: req.user._id
    });
    if (verificationStatus === 'rejected') {
      lead.status = 'assigned';
      lead.transferredToAccounts = false;
    }
    const updatedLead = await lead.save();

    // Notify sales rep
    if (lead.assignedTo) {
      await sendNotification(
        lead.assignedTo,
        verificationStatus === 'verified' ? '✅ Sale Approved' : '❌ Sale Rejected',
        `Lead "${lead.name}" ki sale ${verificationStatus === 'verified' ? 'approve' : 'reject'} ho gayi. Remarks: ${remarks || 'None'}`,
        lead._id
      );
    }

    res.status(200).json({ status: 'success', data: { lead: formatLeadWithIntegrations(updatedLead) } });
  } catch (error) {
    next(error);
  }
};

export const uploadInvoice = async (req, res, next) => {
  try {
    const { awbNumber } = req.body;
    if (!awbNumber || !awbNumber.trim()) {
      res.status(400);
      throw new Error('AWB / Tracking Number is required');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    if (!req.file && !lead.invoiceUrl) {
      res.status(400);
      throw new Error('Please upload an invoice file');
    }

    if (req.file) {
      lead.invoiceUrl = `/uploads/invoices/${req.file.filename}`;
    }
    lead.awbNumber = awbNumber.trim();

    lead.remarks.push({
      note: `[Accounts Team] Invoice & AWB details updated. AWB: ${lead.awbNumber}${req.file ? `, File: ${req.file.originalname}` : ''}`,
      addedBy: req.user._id
    });
    const updatedLead = await lead.save();
    
    // Sync invoice details to any StockMovement linked to this lead
    await StockMovement.updateMany(
      { $or: [{ referenceNo: `SALE-${lead._id}` }, { lead: lead._id }] },
      {
        $set: {
          invoiceNumber: lead.awbNumber,
          invoiceUrl: lead.invoiceUrl,
          customer: lead.name,
          customerPhone: lead.phone,
          salesPerson: lead.assignedTo || undefined,
          lead: lead._id,
        }
      }
    );

    // Notify sales rep about invoice
    if (lead.assignedTo) {
      await sendNotification(lead.assignedTo, '🧾 Invoice & AWB Updated', `Lead "${lead.name}" ke liye invoice aur AWB number update ho gaya (AWB: ${lead.awbNumber})`, lead._id);
    }

    res.status(200).json({ status: 'success', data: { lead: formatLeadWithIntegrations(updatedLead) } });
  } catch (error) {
    next(error);
  }
};

export const updatePaymentAndTransaction = async (req, res, next) => {
  try {
    const { paymentMode, paymentStatus, transactionDetails } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) { res.status(404); throw new Error('Lead not found'); }
    if (paymentMode) {
      if (!['cash', 'cod', 'dp', 'emi'].includes(paymentMode.toLowerCase())) {
        res.status(400); throw new Error('Invalid paymentMode. Allowed: cash, cod, dp, emi');
      }
      lead.paymentMode = paymentMode.toLowerCase();
    }
    if (paymentStatus) {
      if (!['pending', 'partial', 'completed'].includes(paymentStatus.toLowerCase())) {
        res.status(400); throw new Error('Invalid paymentStatus. Allowed: pending, partial, completed');
      }
      lead.paymentStatus = paymentStatus.toLowerCase();
    }
    if (transactionDetails) lead.transactionDetails = transactionDetails;
    lead.remarks.push({
      note: `[Accounts Team] Payment/Transaction updated (Mode: ${lead.paymentMode || 'N/A'}, Status: ${lead.paymentStatus || 'N/A'})`,
      addedBy: req.user._id
    });
    const updatedLead = await lead.save();

    // Notify sales rep
    if (lead.assignedTo) {
      await sendNotification(
        lead.assignedTo,
        '💳 Payment Updated',
        `Lead "${lead.name}" ka payment update hua. Mode: ${lead.paymentMode || 'N/A'}, Status: ${lead.paymentStatus || 'N/A'}`,
        lead._id
      );
    }

    res.status(200).json({ status: 'success', data: { lead: formatLeadWithIntegrations(updatedLead) } });
  } catch (error) {
    next(error);
  }
};

export const updateTrackingId = async (req, res, next) => {
  try {
    const { trackingId } = req.body;
    if (!trackingId) { res.status(400); throw new Error('Please provide trackingId'); }
    const lead = await Lead.findById(req.params.id);
    if (!lead) { res.status(404); throw new Error('Lead not found'); }
    lead.trackingId = trackingId;
    lead.remarks.push({ note: `[Accounts Team] Tracking ID updated: ${trackingId}`, addedBy: req.user._id });
    const updatedLead = await lead.save();

    // Notify sales rep about tracking ID
    if (lead.assignedTo) {
      await sendNotification(lead.assignedTo, '📦 Tracking ID Updated', `Lead "${lead.name}" ka tracking ID update hua: ${trackingId}`, lead._id);
    }

    res.status(200).json({ status: 'success', data: { lead: formatLeadWithIntegrations(updatedLead) } });
  } catch (error) {
    next(error);
  }
};

export const transferToInstallation = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) { res.status(404); throw new Error('Lead not found'); }
    if (lead.verificationStatus !== 'verified') {
      res.status(400); throw new Error('Lead must be approved/verified before transferring to Installation Team');
    }
    if (lead.transferredToInstallation) {
      res.status(400); throw new Error('Lead has already been transferred to Installation Team');
    }

    // Deduct stock if a productId is linked to this lead
    if (lead.productId) {
      const product = await Product.findById(lead.productId);
      if (product) {
        const qty = Number(lead.productQuantity) || 1;
        if (product.currentStock < qty) {
          res.status(400);
          throw new Error(`Insufficient stock in catalog for ${product.name}! Required: ${qty}, Available: ${product.currentStock}`);
        }

        product.currentStock -= qty;

        let warehouseId = null;
        if (product.warehouseStock && product.warehouseStock.length > 0) {
          const whStock = product.warehouseStock.find(w => w.quantity >= qty);
          if (whStock) {
            whStock.quantity -= qty;
            warehouseId = whStock.warehouse;
          } else {
            product.warehouseStock[0].quantity = Math.max(0, product.warehouseStock[0].quantity - qty);
            warehouseId = product.warehouseStock[0].warehouse;
          }
        }

        await product.save();

        let salesPersonName = undefined;
        if (lead.assignedTo) {
          const spUser = await User.findById(lead.assignedTo).select('name').lean();
          if (spUser) salesPersonName = spUser.name;
        }

        // Record Stock Out movement
        await StockMovement.create({
          transactionType: 'stock_out',
          product: product._id,
          warehouse: warehouseId || undefined,
          quantity: -qty,
          unitPrice: product.sellingPrice || product.purchasePrice || 0,
          totalPrice: qty * (product.sellingPrice || product.purchasePrice || 0),
          referenceNo: lead.awbNumber ? `INV-${lead.awbNumber}` : `SALE-${lead._id}`,
          customer: lead.name,
          customerPhone: lead.phone,
          lead: lead._id,
          salesPerson: lead.assignedTo || undefined,
          salesPersonName,
          invoiceNumber: lead.awbNumber || `INV-${lead._id.toString().slice(-6).toUpperCase()}`,
          invoiceUrl: lead.invoiceUrl || undefined,
          notes: `Auto stock deduction on Transfer to Installation of Lead #${lead._id}`,
          performedBy: req.user._id,
          performerModel: req.user.role === 'admin' || req.user.role === 'superAdmin' ? 'Admin' : 'User'
        });
      }
    }

    lead.transferredToInstallation = true;
    lead.status = 'in_process';
    lead.remarks.push({ note: `[Accounts Team] Verified Lead transferred to Installation Team.`, addedBy: req.user._id });
    const updatedLead = await lead.save();

    // Notify admins
    const admins = await Admin.find({ role: { $in: ['superAdmin', 'admin'] }, active: true }).select('_id').lean();
    for (const admin of admins) {
      await sendNotification(admin._id, '🔧 Lead Transferred to Installation', `Lead "${lead.name}" installation team ko transfer ho gayi`, lead._id);
    }
    // Notify installation rep if already assigned
    if (lead.installationRep) {
      await sendNotification(lead.installationRep, '🔧 New Installation Lead', `Lead "${lead.name}" (${lead.phone}) aapko installation ke liye assign ki gayi hai`, lead._id);
    }

    res.status(200).json({ status: 'success', data: { lead: formatLeadWithIntegrations(updatedLead) } });
  } catch (error) {
    next(error);
  }
};
