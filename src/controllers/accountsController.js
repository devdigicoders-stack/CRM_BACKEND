import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Admin } from '../models/Admin.js';
import { Product } from '../models/Product.js';
import { Warehouse } from '../models/Warehouse.js';
import { StockMovement } from '../models/StockMovement.js';
import { Notification } from '../models/Notification.js';
import { sendPushNotification } from '../config/firebase.js';
import { notifyUser, notifyRoles, notifySuperAdminAndAdmins } from '../services/notificationService.js';

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
    const { search, verificationStatus, paymentStatus, assignedTo, startDate, endDate, page = 1, limit = 20 } = req.query;
    
    // Base query logic: if rejected, it's no longer transferredToAccounts
    const query = {};
    if (verificationStatus === 'rejected') {
      query.verificationStatus = 'rejected';
    } else {
      query.transferredToAccounts = true;
      query.status = { $in: ['converted', 'closed'] };
      if (verificationStatus) query.verificationStatus = verificationStatus;
    }

    if (assignedTo && assignedTo !== 'all') {
      query.assignedTo = assignedTo;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cleanPhoneSearch = search.replace(/\D/g, '');
      
      const orConditions = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { phone: { $regex: escapedSearch, $options: 'i' } },
        { email: { $regex: escapedSearch, $options: 'i' } },
        { productDetails: { $regex: escapedSearch, $options: 'i' } }
      ];

      if (cleanPhoneSearch.length >= 10) {
        const last10 = cleanPhoneSearch.slice(-10);
        const flexibleRegex = last10.split('').join('\\D*');
        orConditions.push({ phone: { $regex: flexibleRegex, $options: 'i' } });
      } else if (cleanPhoneSearch.length > 0) {
        const flexibleRegex = cleanPhoneSearch.split('').join('\\D*');
        orConditions.push({ phone: { $regex: flexibleRegex, $options: 'i' } });
      }

      query.$or = orConditions;
    }
    if (paymentStatus) query.paymentStatus = paymentStatus;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skipNum = (pageNum - 1) * limitNum;
    const total = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role phone')
      .populate('remarks.addedBy', 'name email role')
      .populate('productId')
      .populate('items.productId')
      .populate('items.warehouse', 'name code city')
      .populate('dispatchWarehouse', 'name code city address')
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

    // Notify SuperAdmin & Branch Managers on sale verification
    if (verificationStatus === 'verified') {
      notifySuperAdminAndAdmins(
        '✅ Payment & Sale Verified',
        `Lead "${lead.name}" (Deal: ₹${lead.dealValue || lead.totalAmount || ''}) accounts team dwaara verify kar di gayi hai.`,
        lead._id,
        { leadId: lead._id.toString(), verificationStatus },
        'payment_alert'
      ).catch(err => console.error(err));
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
    const { warehouseId, itemWarehouses, remarks: dispatchRemarks } = req.body;

    if (!warehouseId) {
      res.status(400);
      throw new Error('Please select a dispatch warehouse to out the stock');
    }

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      res.status(404);
      throw new Error('Selected dispatch warehouse not found');
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) { res.status(404); throw new Error('Lead not found'); }
    if (lead.verificationStatus !== 'verified') {
      res.status(400); throw new Error('Lead must be approved/verified before transferring to Transport / Installation Team');
    }
    if (lead.transferredToInstallation) {
      res.status(400); throw new Error('Lead has already been transferred to Transport / Installation Team');
    }

    // Set item warehouses if provided
    if (lead.items && lead.items.length > 0) {
      for (let i = 0; i < lead.items.length; i++) {
        const it = lead.items[i];
        let itemWhId = warehouseId;
        if (itemWarehouses) {
          const prodId = it.productId?._id ? it.productId._id.toString() : (it.productId ? it.productId.toString() : null);
          const itId = it._id ? it._id.toString() : null;
          itemWhId = itemWarehouses[i] || (prodId && itemWarehouses[prodId]) || (itId && itemWarehouses[itId]) || itemWarehouses[`item_${i}`] || itemWhId;
        }
        it.warehouse = itemWhId;
      }
    }

    lead.dispatchWarehouse = warehouseId;
    if (dispatchRemarks) lead.dispatchRemarks = dispatchRemarks;
    lead.transferApprovalStatus = 'pending';
    lead.transferRequestedBy = req.user._id;
    lead.transferRequestedAt = new Date();
    lead.transferRejectionRemarks = '';

    // Collect warehouse names for remarks
    let itemWhSummary = '';
    if (lead.items && lead.items.length > 0) {
      const whIds = [...new Set(lead.items.map(it => it.warehouse?.toString()).filter(Boolean))];
      const whList = await Warehouse.find({ _id: { $in: whIds } }).select('name code city');
      const whMap = {};
      whList.forEach(w => { whMap[w._id.toString()] = w.name; });
      itemWhSummary = lead.items.map(it => `${it.name || 'Item'} (${whMap[it.warehouse?.toString()] || warehouse.name})`).join(', ');
    }
    
    lead.remarks.push({
      note: `[Accounts Team] Requested Installation Transfer. Items Warehouses: ${itemWhSummary || `${warehouse.name} (${warehouse.code || 'WH'})`}. Pending SuperAdmin approval for stock deduction.${dispatchRemarks ? ` Remarks: ${dispatchRemarks}` : ''}`,
      addedBy: req.user._id
    });
    
    await lead.save();

    const populatedLead = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email role phone')
      .populate('remarks.addedBy', 'name email role')
      .populate('productId')
      .populate('items.productId')
      .populate('items.warehouse', 'name code city')
      .populate('dispatchWarehouse', 'name code city address')
      .populate('transferRequestedBy', 'name email role phone');

    // Notify SuperAdmin and Admins that approval is required
    notifySuperAdminAndAdmins(
      '📦 Installation Transfer Approval Required',
      `Accounts team requested transfer for Lead "${lead.name}" (${lead.phone}) with multi-warehouse items. SuperAdmin approval required to deduct stock.`,
      lead._id,
      { leadId: lead._id.toString(), type: 'transfer_approval' },
      'transfer_alert'
    ).catch(err => console.error('[Notification Error]:', err.message));

    res.status(200).json({
      status: 'success',
      message: 'Transfer request submitted to SuperAdmin for approval. Stock will be deducted upon approval.',
      data: { lead: formatLeadWithIntegrations(populatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

// --- SuperAdmin Transfer Approval Endpoints ---

export const getTransferRequests = async (req, res, next) => {
  try {
    const { status = 'pending', search } = req.query;
    const query = {};

    if (status && status !== 'all') {
      query.transferApprovalStatus = status;
    } else {
      query.transferApprovalStatus = { $in: ['pending', 'approved', 'rejected'] };
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { awbNumber: { $regex: escaped, $options: 'i' } }
      ];
    }

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role phone')
      .populate('transferRequestedBy', 'name email role phone')
      .populate('transferApprovedBy', 'name email role phone')
      .populate('dispatchWarehouse', 'name code city address managerName phone')
      .populate({
        path: 'productId',
        select: 'name sku currentStock purchasePrice sellingPrice warehouseStock unit',
        populate: { path: 'unit', select: 'name shortName' }
      })
      .populate({
        path: 'items.productId',
        select: 'name sku currentStock purchasePrice sellingPrice warehouseStock unit',
        populate: { path: 'unit', select: 'name shortName' }
      })
      .populate('items.warehouse', 'name code city')
      .populate('installationRep', 'name email role phone')
      .sort({ transferRequestedAt: -1, updatedAt: -1 })
      .lean();

    // Enrich with stock availability summary for the selected dispatch warehouse
    const enrichedLeads = leads.map((l) => {
      const targetWhId = l.dispatchWarehouse?._id?.toString();
      let allAvailable = true;
      const stockCheckItems = [];

      if (l.items && l.items.length > 0) {
        l.items.forEach((it) => {
          const p = it.productId;
          const reqQty = Number(it.quantity) || 1;
          const itemWh = it.warehouse || l.dispatchWarehouse;
          const itemWhId = itemWh?._id?.toString() || itemWh?.toString() || targetWhId;
          let whStock = 0;
          let overallStock = p?.currentStock || 0;
          if (p?.warehouseStock && Array.isArray(p.warehouseStock)) {
            const entry = p.warehouseStock.find(w => w.warehouse?.toString() === itemWhId);
            if (entry) whStock = entry.quantity || 0;
          }
          const isEnough = whStock >= reqQty;
          if (!isEnough) allAvailable = false;
          stockCheckItems.push({
            productId: p?._id,
            productName: p?.name || it.name,
            sku: p?.sku,
            unit: p?.unit?.shortName || 'pcs',
            requestedQty: reqQty,
            warehouseId: itemWhId,
            warehouseName: itemWh?.name || l.dispatchWarehouse?.name || 'Warehouse',
            warehouseStock: whStock,
            overallStock,
            isAvailable: isEnough,
          });
        });
      } else if (l.productId) {
        const p = l.productId;
        const reqQty = Number(l.productQuantity) || 1;
        let whStock = 0;
        let overallStock = p?.currentStock || 0;
        if (p?.warehouseStock && Array.isArray(p.warehouseStock)) {
          const entry = p.warehouseStock.find(w => w.warehouse?.toString() === targetWhId);
          if (entry) whStock = entry.quantity || 0;
        }
        const isEnough = whStock >= reqQty;
        if (!isEnough) allAvailable = false;
        stockCheckItems.push({
          productId: p?._id,
          productName: p?.name || l.productDetails,
          sku: p?.sku,
          unit: p?.unit?.shortName || 'pcs',
          requestedQty: reqQty,
          warehouseId: targetWhId,
          warehouseName: l.dispatchWarehouse?.name || 'Warehouse',
          warehouseStock: whStock,
          overallStock,
          isAvailable: isEnough,
        });
      }

      return {
        ...formatLeadWithIntegrations(l),
        stockCheck: {
          allAvailable,
          items: stockCheckItems,
        }
      };
    });

    res.status(200).json({
      status: 'success',
      count: enrichedLeads.length,
      data: enrichedLeads,
    });
  } catch (error) {
    next(error);
  }
};

export const approveInstallationTransfer = async (req, res, next) => {
  try {
    const { remarks: approvalRemarks } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    if (lead.transferApprovalStatus === 'approved' && lead.transferredToInstallation) {
      return res.status(400).json({ status: 'fail', message: 'Transfer is already approved and stock deducted' });
    }

    if (!lead.dispatchWarehouse) {
      res.status(400);
      throw new Error('No dispatch warehouse associated with this transfer request');
    }

    const warehouse = await Warehouse.findById(lead.dispatchWarehouse);
    if (!warehouse) {
      res.status(404);
      throw new Error('Associated dispatch warehouse not found');
    }

    let salesPersonName = undefined;
    if (lead.assignedTo) {
      const spUser = await User.findById(lead.assignedTo).select('name').lean();
      if (spUser) salesPersonName = spUser.name;
    }

    // Build items to deduct
    const itemsToDeduct = [];
    if (lead.items && lead.items.length > 0) {
      for (const it of lead.items) {
        if (it.productId) {
          const itemWhId = it.warehouse || lead.dispatchWarehouse;
          itemsToDeduct.push({
            productId: it.productId._id || it.productId,
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.price) || 0,
            name: it.name,
            warehouseId: itemWhId,
          });
        }
      }
    } else if (lead.productId) {
      itemsToDeduct.push({
        productId: lead.productId._id || lead.productId,
        quantity: Number(lead.productQuantity) || 1,
        unitPrice: 0,
        name: '',
        warehouseId: lead.dispatchWarehouse,
      });
    }

    // Deduct stock and record stock_out movement
    for (const it of itemsToDeduct) {
      const product = await Product.findById(it.productId);
      if (product) {
        const qty = it.quantity;
        const targetWhId = it.warehouseId || lead.dispatchWarehouse;
        product.currentStock = Math.max(0, product.currentStock - qty);

        if (product.warehouseStock && Array.isArray(product.warehouseStock)) {
          const whStock = product.warehouseStock.find(w => w.warehouse?.toString() === targetWhId.toString());
          if (whStock) {
            whStock.quantity = Math.max(0, whStock.quantity - qty);
          } else {
            product.warehouseStock.push({
              warehouse: targetWhId,
              quantity: 0
            });
          }
        } else {
          product.warehouseStock = [{
            warehouse: targetWhId,
            quantity: 0
          }];
        }

        await product.save();

        const unitPrice = it.unitPrice || product.sellingPrice || product.purchasePrice || 0;

        const itemWarehouse = await Warehouse.findById(targetWhId);
        const itemWhName = itemWarehouse?.name || warehouse.name || 'Warehouse';

        // Record Stock Out movement
        await StockMovement.create({
          transactionType: 'stock_out',
          product: product._id,
          warehouse: targetWhId,
          quantity: -qty,
          unitPrice: unitPrice,
          totalPrice: qty * unitPrice,
          referenceNo: lead.awbNumber ? `INV-${lead.awbNumber}` : `SALE-${lead._id}`,
          customer: lead.name,
          customerPhone: lead.phone,
          lead: lead._id,
          salesPerson: lead.assignedTo || undefined,
          salesPersonName,
          invoiceNumber: lead.awbNumber || `INV-${lead._id.toString().slice(-6).toUpperCase()}`,
          invoiceUrl: lead.invoiceUrl || undefined,
          notes: `[Approved by SuperAdmin] Stock Out for Lead #${lead._id} (${product.name || 'Product'} x${qty}) from warehouse "${itemWhName}"${approvalRemarks ? ` - Remarks: ${approvalRemarks}` : ''}`,
          performedBy: req.user._id,
          performerModel: req.user.role === 'admin' || req.user.role === 'superAdmin' ? 'Admin' : 'User'
        });
      }
    }

    lead.transferredToInstallation = true;
    lead.transferApprovalStatus = 'approved';
    lead.transferApprovalRemarks = approvalRemarks || 'Approved by SuperAdmin';
    lead.transferApprovedBy = req.user._id;
    lead.transferApprovedAt = new Date();
    lead.status = 'in_process';
    
    lead.remarks.push({
      note: `[SuperAdmin] Approved Installation Transfer and deducted stock from warehouse "${warehouse.name} (${warehouse.code || 'WH'})".${approvalRemarks ? ` Remarks: ${approvalRemarks}` : ''}`,
      addedBy: req.user._id
    });

    await lead.save();

    const populatedLead = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email role phone')
      .populate('remarks.addedBy', 'name email role')
      .populate('productId')
      .populate('items.productId')
      .populate('items.warehouse', 'name code city')
      .populate('dispatchWarehouse', 'name code city address')
      .populate('transferRequestedBy', 'name email role phone')
      .populate('transferApprovedBy', 'name email role phone')
      .populate('installationRep', 'name email role phone');

    // Notify Accounts Requester
    if (lead.transferRequestedBy) {
      await sendNotification(
        lead.transferRequestedBy,
        '✅ Installation Transfer Approved',
        `Lead "${lead.name}" transfer request approved! Stock has been deducted from warehouse "${warehouse.name}".`,
        lead._id
      );
    }

    // Notify Installation Team
    notifyRoles(
      ['installation'],
      '🔧 New Lead Transferred for Installation',
      `Lead "${lead.name}" (${lead.phone}) has been approved and transferred from warehouse "${warehouse.name}".`,
      lead._id,
      { leadId: lead._id.toString() },
      'installation_alert'
    ).catch(err => console.error('[Notification Error]:', err.message));

    // Notify installation rep if already assigned
    if (lead.installationRep) {
      await sendNotification(
        lead.installationRep,
        '🔧 Installation Job Ready',
        `Lead "${lead.name}" (${lead.phone}) is ready for installation. Dispatch Warehouse: ${warehouse.name}`,
        lead._id
      );
    }

    res.status(200).json({
      status: 'success',
      message: 'Transfer approved successfully and stock deducted from warehouse.',
      data: { lead: formatLeadWithIntegrations(populatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

export const rejectInstallationTransfer = async (req, res, next) => {
  try {
    const { remarks: rejectionRemarks } = req.body;
    if (!rejectionRemarks || !rejectionRemarks.trim()) {
      return res.status(400).json({ status: 'fail', message: 'Rejection reason/remarks are required' });
    }

    const lead = await Lead.findById(req.params.id).populate('dispatchWarehouse');
    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    lead.transferApprovalStatus = 'rejected';
    lead.transferRejectionRemarks = rejectionRemarks.trim();
    lead.transferredToInstallation = false;

    lead.remarks.push({
      note: `[SuperAdmin] Rejected Installation Transfer request. Reason: ${rejectionRemarks.trim()}`,
      addedBy: req.user._id
    });

    await lead.save();

    const populatedLead = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email role phone')
      .populate('remarks.addedBy', 'name email role')
      .populate('productId')
      .populate('items.productId')
      .populate('dispatchWarehouse', 'name code city address')
      .populate('transferRequestedBy', 'name email role phone');

    // Notify Accounts Requester
    if (lead.transferRequestedBy) {
      await sendNotification(
        lead.transferRequestedBy,
        '❌ Installation Transfer Rejected',
        `Transfer for Lead "${lead.name}" was rejected by SuperAdmin. Reason: ${rejectionRemarks.trim()}`,
        lead._id
      );
    }

    res.status(200).json({
      status: 'success',
      message: 'Transfer request rejected.',
      data: { lead: formatLeadWithIntegrations(populatedLead) }
    });
  } catch (error) {
    next(error);
  }
};

