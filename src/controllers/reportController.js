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
const generateAnalyticsPipeline = (baseQuery, dateFilter) => {
  const createMatch = dateFilter ? { ...baseQuery, createdAt: dateFilter } : baseQuery;
  const saleMatch = dateFilter ? {
    ...baseQuery,
    $or: [
      { saleConfirmedAt: dateFilter },
      { saleConfirmedAt: { $exists: false }, updatedAt: dateFilter }
    ]
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
    const baseQuery = getFilterQuery(req);
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


// Trigger nodemon restart
