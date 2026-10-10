import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Branch } from '../models/Branch.js';
import mongoose from 'mongoose';

// Helper to compile filters based on query params
const getFilterQuery = async (req) => {
  const { search, status, priority, tag, assignedTo, followUpDate, startDate, endDate } = req.query;
  const query = {};

  if (req.user.role === 'sales') {
    query.assignedTo = new mongoose.Types.ObjectId(req.user.id);
  } else if (req.user.role === 'branchManager') {
    const { getBranchUserIds } = await import('../utils/branchHelper.js');
    const branchUserIds = await getBranchUserIds(req.user._id);
    const branchUserObjectIds = branchUserIds.map(id => new mongoose.Types.ObjectId(id));
    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        query.assignedTo = { $eq: null };
      } else {
        const isBranchUser = branchUserIds.some(id => id.toString() === assignedTo);
        query.assignedTo = isBranchUser ? new mongoose.Types.ObjectId(assignedTo) : { $in: [] };
      }
    } else {
      query.$or = [
        { assignedTo: { $in: branchUserObjectIds } },
        { createdBy: { $in: branchUserObjectIds } }
      ];
    }
  } else if (assignedTo) {
    if (assignedTo === 'unassigned') {
      query.assignedTo = { $eq: null };
    } else {
      query.assignedTo = new mongoose.Types.ObjectId(assignedTo);
    }
  }

  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleanPhoneSearch = search.replace(/\D/g, '');
    
    const orConditions = [
      { name: { $regex: escapedSearch, $options: 'i' } },
      { phone: { $regex: escapedSearch, $options: 'i' } },
      { email: { $regex: escapedSearch, $options: 'i' } }
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

  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (tag) {
    const knownStatuses = ['new', 'assigned', 'interested', 'in_process', 'not_interested', 'converted', 'closed', 'call_done'];
    if (typeof tag === 'string' && tag.toLowerCase() === 'unassigned') {
      query.assignedTo = { $eq: null };
    } else if (typeof tag === 'string' && knownStatuses.includes(tag.toLowerCase())) {
      query.status = tag.toLowerCase();
    } else if (Array.isArray(tag)) {
      query.tags = { $in: tag };
    } else if (typeof tag === 'string' && tag.includes(',')) {
      const tagList = tag.split(',').map(t => t.trim()).filter(Boolean);
      query.tags = { $in: tagList };
    } else {
      query.tags = tag;
    }
  }

  if (followUpDate) {
    const startOfDay = new Date(followUpDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(followUpDate);
    endOfDay.setHours(23, 59, 59, 999);
    query.followUpDate = { $gte: startOfDay, $lte: endOfDay };
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

  return query;
};

// @desc    Export leads to Excel sheet
// @route   GET /api/v1/reports/export/excel
// @access  Private (Super Admin, Admin, and Manager only)
export const exportLeadsExcel = async (req, res, next) => {
  try {
    const query = await getFilterQuery(req);

    // Fetch leads without pagination using lean query
    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const data = leads.map((lead) => ({
      Name: lead.name,
      Phone: lead.phone,
      Email: lead.email || 'N/A',
      Source: lead.source || 'Direct',
      Status: lead.status ? lead.status.toUpperCase() : 'N/A',
      Priority: lead.priority ? lead.priority.toUpperCase() : 'N/A',
      Tags: Array.isArray(lead.tags) ? lead.tags.join(', ') : (lead.tags || 'N/A'),
      AssignedTo: lead.assignedTo ? lead.assignedTo.name : 'Unassigned',
      CreatedBy: lead.createdBy ? lead.createdBy.name : 'System',
      FollowUpDate: lead.followUpDate ? new Date(lead.followUpDate).toLocaleString() : 'Not Set',
      RemarksCount: lead.remarks ? lead.remarks.length : 0,
      LatestRemarks: lead.remarks ? lead.remarks.map((r) => r.note).join(' | ') : '',
      CreatedAt: new Date(lead.createdAt).toLocaleDateString(),
    }));

    // Generate Excel Sheet
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads Export');

    // Adjust column widths automatically
    const maxVal = (arr) => arr.reduce((max, v) => (v.toString().length > max ? v.toString().length : max), 10);
    worksheet['!cols'] = Object.keys(data[0] || {}).map((key) => ({
      wch: Math.min(maxVal(data.map((d) => d[key] || '')), 50) + 2,
    }));

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="leads_report.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

// @desc    Export leads summary to PDF report
// @route   GET /api/v1/reports/export/pdf
// @access  Private (Super Admin, Admin, and Manager only)
export const exportLeadsPdf = async (req, res, next) => {
  try {
    const query = await getFilterQuery(req);

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // Create PDF Document
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Disposition', 'attachment; filename="leads_summary_report.pdf"');
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    // Document header background / border
    doc.rect(0, 0, 595.28, 80).fill('#0f172a');

    // Title text
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('SALES TEAM MANAGEMENT CRM', 40, 20);
    doc.fontSize(11).font('Helvetica').text('System Insights & Leads Summary Report', 40, 48);

    // Footer page number
    doc.fillColor('#475569');
    let pageNumber = 1;
    doc.on('pageAdded', () => {
      pageNumber++;
      doc.rect(0, 0, 595.28, 40).fill('#0f172a');
      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text('SALES CRM REPORT', 40, 15);
      doc.fillColor('#475569').fontSize(9).font('Helvetica').text(`Page ${pageNumber}`, 530, 800);
    });

    // Content Start
    doc.fillColor('#000000').fontSize(16).font('Helvetica-Bold').text('Report Overview', 40, 100);
    doc.fontSize(10).font('Helvetica').text(`Report Generated On: ${new Date().toLocaleString()}`, 40, 120);
    doc.text(`Total Filtered Leads: ${leads.length}`, 40, 135);
    doc.moveDown(1.5);

    // Draw horizontal separator line
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);

    // Table Headers
    const tableTop = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Name', 40, tableTop, { width: 120 });
    doc.text('Phone', 160, tableTop, { width: 90 });
    doc.text('Status', 250, tableTop, { width: 90 });
    doc.text('Priority', 340, tableTop, { width: 80 });
    doc.text('Assignee', 430, tableTop, { width: 125 });

    doc.moveDown(0.5);
    doc.strokeColor('#94a3b8').lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);

    // Table Rows
    doc.fontSize(9).font('Helvetica');
    let currentY = doc.y;

    leads.forEach((lead) => {
      // Check if page overflow
      if (currentY > 750) {
        doc.addPage();
        currentY = 100;
        // Repeat table headers on new page
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Name', 40, currentY, { width: 120 });
        doc.text('Phone', 160, currentY, { width: 90 });
        doc.text('Status', 250, currentY, { width: 90 });
        doc.text('Priority', 340, currentY, { width: 80 });
        doc.text('Assignee', 430, currentY, { width: 125 });
        currentY += 15;
        doc.strokeColor('#94a3b8').lineWidth(1.5).moveTo(40, currentY).lineTo(555, currentY).stroke();
        currentY += 10;
        doc.fontSize(9).font('Helvetica');
      }

      const assigneeName = lead.assignedTo ? lead.assignedTo.name : 'Unassigned';

      doc.text(lead.name, 40, currentY, { width: 115, height: 15, ellipsis: true });
      doc.text(lead.phone, 160, currentY, { width: 85, height: 15, ellipsis: true });
      doc.text(lead.status.toUpperCase(), 250, currentY, { width: 85, height: 15, ellipsis: true });
      doc.text(lead.priority.toUpperCase(), 340, currentY, { width: 75, height: 15, ellipsis: true });
      doc.text(assigneeName, 430, currentY, { width: 120, height: 15, ellipsis: true });

      currentY += 20;

      // Draw subtle row divider line
      doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(40, currentY).lineTo(555, currentY).stroke();
      currentY += 5;
    });

    // Add Page Number to first page
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text('Page 1', 530, 800);

    doc.end();
  } catch (error) {
    next(error);
  }
};

// Helper for comprehensive report
const generateAnalyticsPipeline = (baseQuery, dateFilter) => {
  const createMatch = dateFilter ? { ...baseQuery, createdAt: dateFilter } : baseQuery;
  const saleMatch = dateFilter ? {
    ...baseQuery,
    saleConfirmedAt: dateFilter
  } : baseQuery;
  const installMatch = dateFilter ? { ...baseQuery, updatedAt: dateFilter } : baseQuery;

  return [
    {
      $facet: {
        createdTotals: [
          { $match: createMatch },
          {
            $group: {
              _id: null,
              totalLeads: { $sum: 1 },
              pendingLeads: {
                $sum: { $cond: [{ $and: [{ $in: ['$status', ['new', 'assigned', 'interested', 'in_process']] }, { $ne: ['$transferredToInstallation', true] }] }, 1, 0] }
              }
            }
          }
        ],
        saleTotals: [
          { $match: saleMatch },
          {
            $group: {
              _id: null,
              convertedLeads: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, 1, 0] }
              },
              totalDealValue: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$dealValue', 0] }
              },
              totalAmountPaid: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$amountPaid', 0] }
              },
              totalAmountPending: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$pendingAmount', 0] }
              }
            }
          }
        ],
        installTotals: [
          { $match: installMatch },
          {
            $group: {
              _id: null,
              totalInstallations: {
                $sum: { $cond: [{ $eq: ['$transferredToInstallation', true] }, 1, 0] }
              },
              pendingInstallations: {
                $sum: { $cond: [{ $and: [{ $eq: ['$transferredToInstallation', true] }, { $in: ['$installationStatus', ['assigned', 'in_progress']] }] }, 1, 0] }
              },
              completedInstallations: {
                $sum: { $cond: [{ $and: [{ $eq: ['$transferredToInstallation', true] }, { $eq: ['$installationStatus', 'completed'] }] }, 1, 0] }
              }
            }
          }
        ],
        statusBreakdown: [
          { $match: createMatch },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ],
        sourceBreakdown: [
          { $match: createMatch },
          { $group: { _id: '$source', count: { $sum: 1 } } }
        ],
        priorityBreakdown: [
          { $match: createMatch },
          { $group: { _id: '$priority', count: { $sum: 1 } } }
        ]
      }
    }
  ];
};

const formatAnalyticsResult = (result) => {
  if (!result || !result.length) return null;
  const data = result[0];
  const createdTotals = data.createdTotals[0] || { totalLeads: 0, pendingLeads: 0 };
  const saleTotals = data.saleTotals[0] || { convertedLeads: 0, totalDealValue: 0, totalAmountPaid: 0, totalAmountPending: 0 };
  const installTotals = data.installTotals[0] || { totalInstallations: 0, pendingInstallations: 0, completedInstallations: 0 };
  
  const statusBreakdown = {};
  data.statusBreakdown.forEach(item => { statusBreakdown[item._id] = item.count; });
  
  const sourceBreakdown = {};
  data.sourceBreakdown.forEach(item => { sourceBreakdown[item._id || 'Direct'] = item.count; });
  
  const priorityBreakdown = {};
  data.priorityBreakdown.forEach(item => { priorityBreakdown[item._id] = item.count; });

  return {
    totalLeads: createdTotals.totalLeads || 0,
    convertedLeads: saleTotals.convertedLeads || 0,
    pendingLeads: createdTotals.pendingLeads || 0,
    totalDealValue: saleTotals.totalDealValue || 0,
    totalAmountPaid: saleTotals.totalAmountPaid || 0,
    totalAmountPending: saleTotals.totalAmountPending || 0,
    totalInstallations: installTotals.totalInstallations || 0,
    pendingInstallations: installTotals.pendingInstallations || 0,
    completedInstallations: installTotals.completedInstallations || 0,
    statusBreakdown,
    sourceBreakdown,
    priorityBreakdown
  };
};

// @desc    Get Comprehensive Report Analytics
// @route   GET /api/v1/reports/analytics
// @access  Private (Super Admin, Admin, and Manager only)
export const getComprehensiveReport = async (req, res, next) => {
  try {
    const baseQuery = await getFilterQuery(req);
    // Remove the date filter if any so we can explicitly handle the date ranges
    const customCreatedAt = baseQuery.createdAt;
    delete baseQuery.createdAt;
    delete baseQuery.followUpDate;

    const now = new Date();
    
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday as start of week
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Execute parallel aggregations
    const promises = [
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, { $gte: startOfToday })),
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, { $gte: startOfWeek })),
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, { $gte: startOfMonth })),
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, { $gte: startOfYear })),
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, null)), // all time
    ];
    
    if (customCreatedAt) {
      promises.push(Lead.aggregate(generateAnalyticsPipeline(baseQuery, customCreatedAt)));
    }

    const results = await Promise.all(promises);

    const analyticsData = {
      today: formatAnalyticsResult(results[0]),
      thisWeek: formatAnalyticsResult(results[1]),
      thisMonth: formatAnalyticsResult(results[2]),
      thisYear: formatAnalyticsResult(results[3]),
      allTime: formatAnalyticsResult(results[4]),
    };
    
    if (customCreatedAt) {
      analyticsData.custom = formatAnalyticsResult(results[5]);
    }

    res.status(200).json({
      status: 'success',
      data: analyticsData
    });

  } catch (error) {
    next(error);
  }
};


// @desc    Get Details list for a specific KPI
// @route   GET /api/v1/reports/kpi-details
// @access  Private (Super Admin, Admin, and Manager only)
export const getKpiDetails = async (req, res, next) => {
  try {
    const { type, timeframe, startDate, endDate } = req.query;
    
    // Build date filter based on timeframe or start/end dates
    let dateFilter = null;
    if (startDate || endDate) {
      dateFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
    } else if (timeframe && timeframe !== 'allTime') {
      const now = new Date();
      dateFilter = {};
      
      if (timeframe === 'today') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
      } else if (timeframe === 'thisWeek') {
        const start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
      } else if (timeframe === 'thisMonth') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter.$gte = start;
      } else if (timeframe === 'thisYear') {
        const start = new Date(now.getFullYear(), 0, 1);
        dateFilter.$gte = start;
      }
    }

    // Use base filter for access control
    const baseQuery = await getFilterQuery(req);
    delete baseQuery.createdAt;
    delete baseQuery.followUpDate;

    const query = { ...baseQuery };
    
    // Setup conditions based on KPI type
    switch (type) {
      case 'totalLeads':
        if (dateFilter) query.createdAt = dateFilter;
        break;
      case 'pendingLeads':
        if (dateFilter) query.createdAt = dateFilter;
        query.status = { $in: ['new', 'assigned', 'interested', 'in_process'] };
        query.transferredToInstallation = { $ne: true };
        break;
      case 'convertedLeads':
      case 'totalDealValue':
      case 'amountPaid':
      case 'amountPending':
        query.$and = [
          {
            $or: [
              { status: { $in: ['converted', 'closed'] } },
              { transferredToInstallation: true }
            ]
          }
        ];
        if (dateFilter) {
          query.saleConfirmedAt = dateFilter;
        }
        break;
      case 'totalInstallations':
        if (dateFilter) query.updatedAt = dateFilter;
        query.transferredToInstallation = true;
        break;
      case 'pendingInstallations':
        if (dateFilter) query.updatedAt = dateFilter;
        query.transferredToInstallation = true;
        query.installationStatus = { $in: ['assigned', 'in_progress'] };
        break;
      case 'completedInstallations':
        if (dateFilter) query.updatedAt = dateFilter;
        query.transferredToInstallation = true;
        query.installationStatus = 'completed';
        break;
      default:
        if (dateFilter) query.createdAt = dateFilter;
    }

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      status: 'success',
      count: leads.length,
      data: leads
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Get Telecaller Comprehensive Analytics & Leaderboard
// @route   GET /api/v1/reports/telecaller-analytics
// @access  Private (superAdmin, admin, branchManager)
export const getTelecallerAnalytics = async (req, res, next) => {
  try {
    const { telecallerId, timeframe, startDate, endDate, branchId, city, state, pinCode, location } = req.query;

    // 1. Fetch relevant telecallers
    let telecallerQuery = { role: { $in: ['telecaller', 'calling', 'crmuser'] } };
    if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      telecallerQuery._id = { $in: branchUserIds };
    }
    const allTelecallers = await User.find(telecallerQuery)
      .select('name email phone role active profilePic')
      .sort({ name: 1 })
      .lean();

    const telecallerMap = new Map();
    allTelecallers.forEach(t => telecallerMap.set(t._id.toString(), t));

    // Determine target telecaller IDs
    let targetTelecallerIds = [];
    const isSingleTelecaller = telecallerId && telecallerId !== 'all';
    if (isSingleTelecaller) {
      if (mongoose.Types.ObjectId.isValid(telecallerId)) {
        targetTelecallerIds = [new mongoose.Types.ObjectId(telecallerId)];
      }
    } else {
      targetTelecallerIds = allTelecallers.map(t => t._id);
    }

    // 2. Date filter
    const now = new Date();
    let dateFilter = null;
    if (startDate || endDate) {
      dateFilter = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        dateFilter.$lte = e;
      }
    } else if (timeframe && timeframe !== 'allTime') {
      dateFilter = {};
      if (timeframe === 'today') {
        const s = new Date(now);
        s.setHours(0, 0, 0, 0);
        const e = new Date(now);
        e.setHours(23, 59, 59, 999);
        dateFilter.$gte = s;
        dateFilter.$lte = e;
      } else if (timeframe === 'thisWeek') {
        const s = new Date(now);
        s.setDate(now.getDate() - now.getDay());
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      } else if (timeframe === 'thisMonth') {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      } else if (timeframe === 'thisYear') {
        const s = new Date(now.getFullYear(), 0, 1);
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      }
    }

    // 3. Build Query
    const query = {};
    if (targetTelecallerIds.length > 0) {
      if (isSingleTelecaller) {
        query.$or = [
          { originTelecaller: { $in: targetTelecallerIds } },
          { assignedTo: { $in: targetTelecallerIds } },
          { 'remarks.addedBy': { $in: targetTelecallerIds } }
        ];
      } else {
        query.$or = [
          { originTelecaller: { $in: targetTelecallerIds } },
          { assignedTo: { $in: targetTelecallerIds } },
          { 'remarks.addedBy': { $in: targetTelecallerIds } },
          { originTelecaller: { $ne: null } }
        ];
      }
    }

    if (dateFilter) {
      query.createdAt = dateFilter;
    }

    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      query.assignedBranch = new mongoose.Types.ObjectId(branchId);
    }

    // Location Filters (State, City, PinCode, Location text)
    if (state && state.trim()) {
      query.state = { $regex: new RegExp(`^${state.trim()}$`, 'i') };
    }
    if (city && city.trim()) {
      query.city = { $regex: new RegExp(`^${city.trim()}$`, 'i') };
    }
    if (pinCode && pinCode.trim()) {
      query.pinCode = pinCode.trim();
    }
    if (location && location.trim()) {
      const locRegex = { $regex: location.trim(), $options: 'i' };
      const locConds = [
        { city: locRegex },
        { state: locRegex },
        { pinCode: locRegex },
        { address: locRegex }
      ];
      if (query.$and) {
        query.$and.push({ $or: locConds });
      } else {
        query.$and = [{ $or: locConds }];
      }
    }

    // Fetch leads
    const leads = await Lead.find(query)
      .populate('originTelecaller', 'name email phone')
      .populate('assignedTo', 'name email phone role')
      .populate('assignedBranch', 'name city state')
      .select('name phone email address city state pinCode status priority source originTelecaller assignedBranch assignedTo followUpDate dealValue amountPaid telecallerIncentive remarks createdAt updatedAt isCallDone transferredToInstallation')
      .lean();

    // 4. Calculate Aggregate Metrics
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    let totalCalls = 0;
    let qualifiedCount = 0;
    let convertedCount = 0;
    let totalDealValue = 0;
    let totalIncentive = 0;
    let pendingFollowups = 0;
    let todayFollowups = 0;
    let overdueFollowups = 0;
    let upcomingFollowups = 0;

    const statusBreakdown = {
      new: 0,
      unscreened: 0,
      screening_in_progress: 0,
      interested: 0,
      callback: 0,
      qualified: 0,
      assigned_to_branch: 0,
      converted: 0,
      closed: 0,
      not_interested: 0,
      invalid_number: 0,
      disqualified: 0,
      call_done: 0,
      other: 0,
    };

    const branchBreakdown = {};
    const cityBreakdown = {};
    const stateBreakdown = {};

    // Helper to identify if remark was by telecaller
    const isTelecallerRemark = (r) => {
      if (!r) return false;
      if (r.note && (r.note.includes('[TELECALLER') || r.note.includes('[QUALIFIED'))) return true;
      if (r.addedBy && targetTelecallerIds.length > 0) {
        const addedById = r.addedBy._id ? r.addedBy._id.toString() : r.addedBy.toString();
        return targetTelecallerIds.some(id => id.toString() === addedById);
      }
      return false;
    };

    leads.forEach(lead => {
      const st = lead.status || 'new';
      if (statusBreakdown[st] !== undefined) {
        statusBreakdown[st]++;
      } else {
        statusBreakdown.other++;
      }

      // Count remarks / calls
      if (Array.isArray(lead.remarks)) {
        lead.remarks.forEach(r => {
          if (isTelecallerRemark(r)) {
            if (dateFilter) {
              const rDate = new Date(r.createdAt);
              if (dateFilter.$gte && rDate < dateFilter.$gte) return;
              if (dateFilter.$lte && rDate > dateFilter.$lte) return;
            }
            totalCalls++;
          }
        });
      }

      // Qualified / Handed over to branch
      const isQualified = st === 'assigned_to_branch' || lead.assignedBranch || (Array.isArray(lead.remarks) && lead.remarks.some(r => r.note && r.note.includes('[QUALIFIED')));
      if (isQualified) {
        qualifiedCount++;
        const branchName = lead.assignedBranch?.name || 'Unassigned Branch';
        branchBreakdown[branchName] = (branchBreakdown[branchName] || 0) + 1;
      }

      // Location breakdowns
      if (lead.city && lead.city.trim()) {
        const cName = lead.city.trim();
        cityBreakdown[cName] = (cityBreakdown[cName] || 0) + 1;
      }
      if (lead.state && lead.state.trim()) {
        const sName = lead.state.trim();
        stateBreakdown[sName] = (stateBreakdown[sName] || 0) + 1;
      }

      // Converted to sales
      const isConverted = ['converted', 'closed'].includes(st) || lead.transferredToInstallation === true;
      if (isConverted) {
        convertedCount++;
        const val = Number(lead.dealValue) || 0;
        totalDealValue += val;
        const inc = Number(lead.telecallerIncentive) || (val > 0 ? Math.round(val * 0.05) : 500);
        totalIncentive += inc;
      }

      // Follow-up calculations
      if (lead.followUpDate) {
        const fDate = new Date(lead.followUpDate);
        if (!['converted', 'closed'].includes(st)) {
          pendingFollowups++;
          if (fDate >= startOfToday && fDate <= endOfToday) {
            todayFollowups++;
          } else if (fDate < startOfToday) {
            overdueFollowups++;
          } else if (fDate > endOfToday) {
            upcomingFollowups++;
          }
        }
      }
    });

    const totalLeads = leads.length;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0.0';
    const qualificationRate = totalLeads > 0 ? ((qualifiedCount / totalLeads) * 100).toFixed(1) : '0.0';

    // 5. Daily Trend (Last 7 Days)
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyActivity = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayName = daysOfWeek[d.getDay()];
      const dateStr = d.toISOString().split('T')[0];

      let dayCalls = 0;
      let dayQualified = 0;
      let dayConverted = 0;

      leads.forEach(l => {
        if (Array.isArray(l.remarks)) {
          l.remarks.forEach(r => {
            if (r.createdAt && isTelecallerRemark(r)) {
              if (new Date(r.createdAt).toISOString().split('T')[0] === dateStr) {
                dayCalls++;
              }
            }
          });
        }

        if (l.updatedAt && new Date(l.updatedAt).toISOString().split('T')[0] === dateStr) {
          if (l.status === 'assigned_to_branch' || l.assignedBranch) dayQualified++;
          if (['converted', 'closed'].includes(l.status)) dayConverted++;
        }
      });

      dailyActivity.push({
        day: dayName,
        date: dateStr,
        calls: dayCalls,
        qualified: dayQualified,
        converted: dayConverted
      });
    }

    // 6. Leaderboard / Per-Telecaller Comparison
    const leaderboardMap = new Map();
    allTelecallers.forEach(t => {
      leaderboardMap.set(t._id.toString(), {
        _id: t._id,
        name: t.name,
        email: t.email,
        phone: t.phone || '',
        role: t.role,
        active: t.active,
        totalLeads: 0,
        totalCalls: 0,
        qualified: 0,
        converted: 0,
        dealValue: 0,
        incentive: 0,
        pendingFollowups: 0,
        overdueFollowups: 0,
        conversionRate: '0.0%'
      });
    });

    leads.forEach(lead => {
      let primaryTelecallerId = null;
      if (lead.originTelecaller?._id) {
        primaryTelecallerId = lead.originTelecaller._id.toString();
      } else if (lead.assignedTo?._id && ['telecaller', 'calling', 'crmuser'].includes(lead.assignedTo.role)) {
        primaryTelecallerId = lead.assignedTo._id.toString();
      } else if (Array.isArray(lead.remarks) && lead.remarks.length > 0) {
        for (const r of lead.remarks) {
          const rAdded = r.addedBy?._id ? r.addedBy._id.toString() : r.addedBy?.toString();
          if (rAdded && leaderboardMap.has(rAdded)) {
            primaryTelecallerId = rAdded;
            break;
          }
        }
      }

      if (primaryTelecallerId && leaderboardMap.has(primaryTelecallerId)) {
        const stats = leaderboardMap.get(primaryTelecallerId);
        stats.totalLeads++;

        const isLeadQualified = lead.status === 'assigned_to_branch' || lead.assignedBranch;
        if (isLeadQualified) stats.qualified++;

        const isLeadConverted = ['converted', 'closed'].includes(lead.status) || lead.transferredToInstallation === true;
        if (isLeadConverted) {
          stats.converted++;
          const val = Number(lead.dealValue) || 0;
          stats.dealValue += val;
          stats.incentive += Number(lead.telecallerIncentive) || (val > 0 ? Math.round(val * 0.05) : 500);
        }

        if (lead.followUpDate && !['converted', 'closed'].includes(lead.status)) {
          stats.pendingFollowups++;
          if (new Date(lead.followUpDate) < startOfToday) {
            stats.overdueFollowups++;
          }
        }
      }

      if (Array.isArray(lead.remarks)) {
        lead.remarks.forEach(r => {
          const rAdded = r.addedBy?._id ? r.addedBy._id.toString() : r.addedBy?.toString();
          if (rAdded && leaderboardMap.has(rAdded)) {
            leaderboardMap.get(rAdded).totalCalls++;
          }
        });
      }
    });

    const leaderboard = Array.from(leaderboardMap.values()).map(item => {
      const rate = item.totalLeads > 0 ? ((item.converted / item.totalLeads) * 100).toFixed(1) : '0.0';
      return {
        ...item,
        conversionRate: `${rate}%`
      };
    }).sort((a, b) => b.qualified - a.qualified || b.totalCalls - a.totalCalls);

    // Fetch distinct available locations for filtering dropdowns
    const [distinctCities, distinctStates] = await Promise.all([
      Lead.distinct('city', { city: { $nin: ['', null] } }).catch(() => []),
      Lead.distinct('state', { state: { $nin: ['', null] } }).catch(() => [])
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalLeads,
          totalCalls,
          qualifiedCount,
          convertedCount,
          conversionRate: `${conversionRate}%`,
          qualificationRate: `${qualificationRate}%`,
          totalDealValue,
          totalIncentive,
          pendingFollowups,
          todayFollowups,
          overdueFollowups,
          upcomingFollowups,
        },
        statusBreakdown,
        branchBreakdown,
        cityBreakdown,
        stateBreakdown,
        availableLocations: {
          cities: distinctCities.filter(Boolean).sort(),
          states: distinctStates.filter(Boolean).sort(),
        },
        dailyActivity,
        leaderboard,
        telecallers: allTelecallers
      }
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Get Telecaller Drilldown Leads List
// @route   GET /api/v1/reports/telecaller-drilldown
// @access  Private (superAdmin, admin, branchManager)
export const getTelecallerDrilldown = async (req, res, next) => {
  try {
    const { telecallerId, metricType, statusValue, timeframe, startDate, endDate, branchId, search, city, state, pinCode, location } = req.query;

    const query = {};

    // 1. Telecaller condition
    if (telecallerId && telecallerId !== 'all') {
      if (mongoose.Types.ObjectId.isValid(telecallerId)) {
        const tId = new mongoose.Types.ObjectId(telecallerId);
        query.$or = [
          { originTelecaller: tId },
          { assignedTo: tId },
          { 'remarks.addedBy': tId }
        ];
      }
    }

    // 2. Metric / KPI Type condition
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    switch (metricType) {
      case 'callsLogged':
        query['remarks.0'] = { $exists: true };
        break;
      case 'qualified':
      case 'handedOver':
        query.$and = [
          ...(query.$and || []),
          {
            $or: [
              { status: 'assigned_to_branch' },
              { assignedBranch: { $ne: null } }
            ]
          }
        ];
        break;
      case 'converted':
        query.$and = [
          ...(query.$and || []),
          {
            $or: [
              { status: { $in: ['converted', 'closed'] } },
              { transferredToInstallation: true }
            ]
          }
        ];
        break;
      case 'pendingFollowups':
        query.followUpDate = { $ne: null };
        query.status = { $nin: ['converted', 'closed'] };
        break;
      case 'todayFollowups':
        query.followUpDate = { $gte: startOfToday, $lte: endOfToday };
        query.status = { $nin: ['converted', 'closed'] };
        break;
      case 'overdueFollowups':
        query.followUpDate = { $lt: startOfToday };
        query.status = { $nin: ['converted', 'closed', 'assigned_to_branch'] };
        break;
      case 'status':
        if (statusValue) {
          query.status = statusValue;
        }
        break;
      default:
        // 'totalLeads' - no extra metric condition
        break;
    }

    // 3. Date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        query.createdAt.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        query.createdAt.$lte = e;
      }
    } else if (timeframe && timeframe !== 'allTime') {
      if (timeframe === 'today') {
        query.createdAt = { $gte: startOfToday, $lte: endOfToday };
      } else if (timeframe === 'thisWeek') {
        const s = new Date(now);
        s.setDate(now.getDate() - now.getDay());
        s.setHours(0, 0, 0, 0);
        query.createdAt = { $gte: s };
      } else if (timeframe === 'thisMonth') {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        s.setHours(0, 0, 0, 0);
        query.createdAt = { $gte: s };
      } else if (timeframe === 'thisYear') {
        const s = new Date(now.getFullYear(), 0, 1);
        s.setHours(0, 0, 0, 0);
        query.createdAt = { $gte: s };
      }
    }

    // 4. Branch filter
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      query.assignedBranch = new mongoose.Types.ObjectId(branchId);
    }

    // Location Filters for Drilldown
    if (state && state.trim()) {
      query.state = { $regex: new RegExp(`^${state.trim()}$`, 'i') };
    }
    if (city && city.trim()) {
      query.city = { $regex: new RegExp(`^${city.trim()}$`, 'i') };
    }
    if (pinCode && pinCode.trim()) {
      query.pinCode = pinCode.trim();
    }
    if (location && location.trim()) {
      const locRegex = { $regex: location.trim(), $options: 'i' };
      const locConds = [
        { city: locRegex },
        { state: locRegex },
        { pinCode: locRegex },
        { address: locRegex }
      ];
      if (query.$and) {
        query.$and.push({ $or: locConds });
      } else {
        query.$and = [{ $or: locConds }];
      }
    }

    // 5. Search
    if (search) {
      const searchCond = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } }
      ];
      if (query.$and) {
        query.$and.push({ $or: searchCond });
      } else {
        query.$and = [{ $or: searchCond }];
      }
    }

    const leads = await Lead.find(query)
      .populate('originTelecaller', 'name email phone')
      .populate('assignedTo', 'name email phone role')
      .populate('assignedBranch', 'name city state')
      .populate('remarks.addedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    res.status(200).json({
      status: 'success',
      count: leads.length,
      data: leads
    });

  } catch (error) {
    next(error);
  }
};

