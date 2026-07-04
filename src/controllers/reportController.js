import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { Lead } from '../models/Lead.js';

// Helper to compile filters based on query params
const getFilterQuery = (req) => {
  const { search, status, priority, tag, assignedTo, followUpDate, startDate, endDate } = req.query;
  const query = {};

  if (req.user.role === 'sales') {
    query.assignedTo = req.user.id;
  } else if (assignedTo) {
    query.assignedTo = assignedTo;
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (tag) query.tags = tag;

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
    const query = getFilterQuery(req);

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
      Status: lead.status.toUpperCase(),
      Priority: lead.priority.toUpperCase(),
      AssignedTo: lead.assignedTo ? lead.assignedTo.name : 'Unassigned',
      CreatedBy: lead.createdBy ? lead.createdBy.name : 'System',
      FollowUpDate: lead.followUpDate ? new Date(lead.followUpDate).toLocaleString() : 'Not Set',
      RemarksCount: lead.remarks.length,
      LatestRemarks: lead.remarks.map((r) => r.note).join(' | '),
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
    const query = getFilterQuery(req);

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
const generateAnalyticsPipeline = (matchQuery) => {
  return [
    { $match: matchQuery },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalLeads: { $sum: 1 },
              convertedLeads: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, 1, 0] }
              },
              pendingLeads: {
                $sum: { $cond: [{ $and: [{ $in: ['$status', ['new', 'assigned', 'interested', 'in_process']] }, { $ne: ['$transferredToInstallation', true] }] }, 1, 0] }
              },
              totalDealValue: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$dealValue', 0] }
              },
              totalAmountPaid: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$amountPaid', 0] }
              },
              totalAmountPending: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$pendingAmount', 0] }
              },
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
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ],
        sourceBreakdown: [
          { $group: { _id: '$source', count: { $sum: 1 } } }
        ],
        priorityBreakdown: [
          { $group: { _id: '$priority', count: { $sum: 1 } } }
        ]
      }
    }
  ];
};

const formatAnalyticsResult = (result) => {
  if (!result || !result.length) return null;
  const data = result[0];
  const totals = data.totals[0] || { 
    totalLeads: 0, convertedLeads: 0, pendingLeads: 0, totalDealValue: 0,
    totalAmountPaid: 0, totalAmountPending: 0,
    totalInstallations: 0, pendingInstallations: 0, completedInstallations: 0
  };
  
  const statusBreakdown = {};
  data.statusBreakdown.forEach(item => { statusBreakdown[item._id] = item.count; });
  
  const sourceBreakdown = {};
  data.sourceBreakdown.forEach(item => { sourceBreakdown[item._id || 'Direct'] = item.count; });
  
  const priorityBreakdown = {};
  data.priorityBreakdown.forEach(item => { priorityBreakdown[item._id] = item.count; });

  return {
    totalLeads: totals.totalLeads || 0,
    convertedLeads: totals.convertedLeads || 0,
    pendingLeads: totals.pendingLeads || 0,
    totalDealValue: totals.totalDealValue || 0,
    totalAmountPaid: totals.totalAmountPaid || 0,
    totalAmountPending: totals.totalAmountPending || 0,
    totalInstallations: totals.totalInstallations || 0,
    pendingInstallations: totals.pendingInstallations || 0,
    completedInstallations: totals.completedInstallations || 0,
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
    const baseQuery = getFilterQuery(req);
    // Remove the date filter if any so we can explicitly handle the date ranges
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

    const todayQuery = { ...baseQuery, createdAt: { $gte: startOfToday } };
    const weekQuery = { ...baseQuery, createdAt: { $gte: startOfWeek } };
    const monthQuery = { ...baseQuery, createdAt: { $gte: startOfMonth } };
    const yearQuery = { ...baseQuery, createdAt: { $gte: startOfYear } };
    const allTimeQuery = { ...baseQuery }; // No date restriction

    // Execute parallel aggregations
    const [todayRes, weekRes, monthRes, yearRes, allTimeRes] = await Promise.all([
      Lead.aggregate(generateAnalyticsPipeline(todayQuery)),
      Lead.aggregate(generateAnalyticsPipeline(weekQuery)),
      Lead.aggregate(generateAnalyticsPipeline(monthQuery)),
      Lead.aggregate(generateAnalyticsPipeline(yearQuery)),
      Lead.aggregate(generateAnalyticsPipeline(allTimeQuery)),
    ]);

    const analyticsData = {
      today: formatAnalyticsResult(todayRes),
      thisWeek: formatAnalyticsResult(weekRes),
      thisMonth: formatAnalyticsResult(monthRes),
      thisYear: formatAnalyticsResult(yearRes),
      allTime: formatAnalyticsResult(allTimeRes),
    };

    res.status(200).json({
      status: 'success',
      data: analyticsData
    });

  } catch (error) {
    next(error);
  }
};


// Trigger nodemon restart
