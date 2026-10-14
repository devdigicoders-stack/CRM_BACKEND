import { Lead } from '../models/Lead.js';

// Format YYYY-MM into readable format like "October 2026"
export const formatMonthLabel = (mStr) => {
  if (!mStr || typeof mStr !== 'string' || !mStr.includes('-')) return mStr || '';
  const [y, m] = mStr.split('-');
  const dateObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, 1));
  return dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

// Format YYYY-MM-DD into readable format like "13 Oct 2026"
export const formatDateLabel = (dStr) => {
  if (!dStr || typeof dStr !== 'string' || !dStr.includes('-')) return dStr || '';
  const [y, m, day] = dStr.split('-');
  const dateObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(day, 10)));
  return dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// Get current IST date & month strings
export const getISTCurrentDates = () => {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now); // 'YYYY-MM-DD'
  const thisMonthStr = todayStr.substring(0, 7); // 'YYYY-MM'

  const yDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(yDate);

  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(prevMonthDate).substring(0, 7);

  return { todayStr, yesterdayStr, thisMonthStr, lastMonthStr };
};

/**
 * Criteria for a COUNTED SALE:
 * 1. Verified by Accounts: verificationStatus === 'verified'
 * 2. Approved by SuperAdmin: transferApprovalStatus === 'approved' OR transferredToInstallation === true
 * 3. NOT dependent on installation completion.
 */
export const getSaleQualificationMatch = (extraQuery = {}) => {
  return {
    verificationStatus: 'verified',
    $or: [
      { transferApprovalStatus: 'approved' },
      { transferredToInstallation: true }
    ],
    ...extraQuery
  };
};

/**
 * Aggregates Day-Wise and Month-Wise sales count and revenue.
 */
export const getSalesRevenueMetrics = async ({
  scopeQuery = {},
  date = null,
  startDate = null,
  endDate = null,
  limitDays = 60,
  limitMonths = 24
} = {}) => {
  const matchCondition = getSaleQualificationMatch(scopeQuery);
  const { todayStr, yesterdayStr, thisMonthStr, lastMonthStr } = getISTCurrentDates();

  const pipeline = [
    { $match: matchCondition },
    {
      $project: {
        _id: 1,
        name: 1,
        phone: 1,
        dealValue: {
          $cond: [
            { $gt: ['$dealValue', 0] },
            '$dealValue',
            {
              $cond: [
                { $gt: [{ $add: [{ $ifNull: ['$amountPaid', 0] }, { $ifNull: ['$pendingAmount', 0] }] }, 0] },
                { $add: [{ $ifNull: ['$amountPaid', 0] }, { $ifNull: ['$pendingAmount', 0] }] },
                { $ifNull: ['$dealValue', 0] }
              ]
            }
          ]
        },
        amountPaid: { $ifNull: ['$amountPaid', 0] },
        pendingAmount: { $ifNull: ['$pendingAmount', 0] },
        bookingAmount: { $ifNull: ['$bookingAmount', 0] },
        isBookingAmount: { $ifNull: ['$isBookingAmount', false] },
        effectiveDate: {
          $ifNull: [
            '$transferApprovedAt',
            {
              $ifNull: [
                '$verifiedAt',
                {
                  $ifNull: [
                    '$saleConfirmedAt',
                    { $ifNull: ['$updatedAt', '$createdAt'] }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      $project: {
        _id: 1,
        name: 1,
        phone: 1,
        dealValue: 1,
        amountPaid: 1,
        pendingAmount: 1,
        bookingAmount: 1,
        isBookingAmount: 1,
        effectiveDate: 1,
        dateStr: {
          $dateToString: { format: '%Y-%m-%d', date: '$effectiveDate', timezone: '+05:30' }
        },
        monthStr: {
          $dateToString: { format: '%Y-%m', date: '$effectiveDate', timezone: '+05:30' }
        }
      }
    }
  ];

  // Optional date filters for day-wise breakdown
  const dayWiseMatch = {};
  if (date) {
    dayWiseMatch.dateStr = date;
  } else if (startDate || endDate) {
    dayWiseMatch.dateStr = {};
    if (startDate) dayWiseMatch.dateStr.$gte = startDate;
    if (endDate) dayWiseMatch.dateStr.$lte = endDate;
  }

  pipeline.push({
    $facet: {
      total: [
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            revenue: { $sum: '$dealValue' },
            amountPaid: { $sum: '$amountPaid' },
            pendingAmount: { $sum: '$pendingAmount' },
            bookingAmount: { $sum: '$bookingAmount' }
          }
        }
      ],
      monthWise: [
        {
          $group: {
            _id: '$monthStr',
            count: { $sum: 1 },
            revenue: { $sum: '$dealValue' },
            amountPaid: { $sum: '$amountPaid' },
            pendingAmount: { $sum: '$pendingAmount' },
            bookingAmount: { $sum: '$bookingAmount' }
          }
        },
        { $sort: { _id: -1 } },
        { $limit: limitMonths }
      ],
      dayWiseAll: [
        {
          $group: {
            _id: '$dateStr',
            count: { $sum: 1 },
            revenue: { $sum: '$dealValue' },
            amountPaid: { $sum: '$amountPaid' },
            pendingAmount: { $sum: '$pendingAmount' },
            bookingAmount: { $sum: '$bookingAmount' }
          }
        },
        { $sort: { _id: -1 } }
      ]
    }
  });

  const [aggResult] = await Lead.aggregate(pipeline);

  const totalRaw = aggResult?.total?.[0] || { count: 0, revenue: 0, amountPaid: 0, pendingAmount: 0, bookingAmount: 0 };
  const total = {
    count: totalRaw.count || 0,
    revenue: totalRaw.revenue || 0,
    amountPaid: totalRaw.amountPaid || 0,
    pendingAmount: totalRaw.pendingAmount || 0,
    bookingAmount: totalRaw.bookingAmount || 0
  };

  const monthWise = (aggResult?.monthWise || []).map((m) => ({
    month: m._id,
    monthLabel: formatMonthLabel(m._id),
    count: m.count || 0,
    revenue: m.revenue || 0,
    amountPaid: m.amountPaid || 0,
    pendingAmount: m.pendingAmount || 0,
    bookingAmount: m.bookingAmount || 0
  }));

  const allDays = (aggResult?.dayWiseAll || []).map((d) => ({
    date: d._id,
    formattedDate: formatDateLabel(d._id),
    count: d.count || 0,
    revenue: d.revenue || 0,
    amountPaid: d.amountPaid || 0,
    pendingAmount: d.pendingAmount || 0,
    bookingAmount: d.bookingAmount || 0
  }));

  // Find today's stats from allDays
  const todayMatch = allDays.find((d) => d.date === todayStr);
  const today = todayMatch || {
    date: todayStr,
    formattedDate: formatDateLabel(todayStr),
    count: 0,
    revenue: 0,
    amountPaid: 0,
    pendingAmount: 0,
    bookingAmount: 0
  };

  // Find yesterday's stats
  const yesterdayMatch = allDays.find((d) => d.date === yesterdayStr);
  const yesterday = yesterdayMatch || {
    date: yesterdayStr,
    formattedDate: formatDateLabel(yesterdayStr),
    count: 0,
    revenue: 0,
    amountPaid: 0,
    pendingAmount: 0,
    bookingAmount: 0
  };

  // Find this month's stats
  const thisMonthMatch = monthWise.find((m) => m.month === thisMonthStr);
  const thisMonth = thisMonthMatch || {
    month: thisMonthStr,
    monthLabel: formatMonthLabel(thisMonthStr),
    count: 0,
    revenue: 0,
    amountPaid: 0,
    pendingAmount: 0,
    bookingAmount: 0
  };

  // Find last month's stats
  const lastMonthMatch = monthWise.find((m) => m.month === lastMonthStr);
  const lastMonth = lastMonthMatch || {
    month: lastMonthStr,
    monthLabel: formatMonthLabel(lastMonthStr),
    count: 0,
    revenue: 0,
    amountPaid: 0,
    pendingAmount: 0,
    bookingAmount: 0
  };

  // Filter dayWise list if specific filter is applied or limit to limitDays
  let dayWiseFiltered = allDays;
  if (date) {
    dayWiseFiltered = allDays.filter((d) => d.date === date);
  } else if (startDate || endDate) {
    dayWiseFiltered = allDays.filter((d) => {
      if (startDate && d.date < startDate) return false;
      if (endDate && d.date > endDate) return false;
      return true;
    });
  } else {
    dayWiseFiltered = allDays.slice(0, limitDays);
  }

  // Selected date stats (if date parameter was passed)
  let selectedDateStats = null;
  if (date) {
    selectedDateStats = allDays.find((d) => d.date === date) || {
      date,
      formattedDate: formatDateLabel(date),
      count: 0,
      revenue: 0,
      amountPaid: 0,
      pendingAmount: 0,
      bookingAmount: 0
    };
  }

  return {
    summary: {
      today,
      yesterday,
      thisMonth,
      lastMonth,
      total,
      selectedDate: selectedDateStats
    },
    dayWise: dayWiseFiltered,
    monthWise,
    metadata: {
      qualificationCriteria: 'verified_by_accounts_and_approved_by_superadmin',
      timezone: 'Asia/Kolkata (+05:30)',
      totalDaysTracked: allDays.length,
      totalMonthsTracked: monthWise.length
    }
  };
};

/**
 * Fetch detailed leads for a given day or month (for drilldown modal)
 */
export const getApprovedSalesLeads = async ({
  scopeQuery = {},
  date = null,
  month = null,
  search = '',
  page = 1,
  limit = 20
} = {}) => {
  const matchCondition = getSaleQualificationMatch(scopeQuery);

  const pipeline = [
    { $match: matchCondition },
    {
      $project: {
        _id: 1,
        name: 1,
        phone: 1,
        email: 1,
        city: 1,
        state: 1,
        dealValue: {
          $cond: [
            { $gt: ['$dealValue', 0] },
            '$dealValue',
            {
              $cond: [
                { $gt: [{ $add: [{ $ifNull: ['$amountPaid', 0] }, { $ifNull: ['$pendingAmount', 0] }] }, 0] },
                { $add: [{ $ifNull: ['$amountPaid', 0] }, { $ifNull: ['$pendingAmount', 0] }] },
                { $ifNull: ['$dealValue', 0] }
              ]
            }
          ]
        },
        amountPaid: { $ifNull: ['$amountPaid', 0] },
        pendingAmount: { $ifNull: ['$pendingAmount', 0] },
        bookingAmount: { $ifNull: ['$bookingAmount', 0] },
        isBookingAmount: { $ifNull: ['$isBookingAmount', false] },
        paymentStatus: 1,
        paymentMode: 1,
        verificationStatus: 1,
        transferApprovalStatus: 1,
        assignedTo: 1,
        invoiceUrl: 1,
        awbNumber: 1,
        effectiveDate: {
          $ifNull: [
            '$transferApprovedAt',
            {
              $ifNull: [
                '$verifiedAt',
                {
                  $ifNull: [
                    '$saleConfirmedAt',
                    { $ifNull: ['$updatedAt', '$createdAt'] }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      $project: {
        _id: 1,
        name: 1,
        phone: 1,
        email: 1,
        city: 1,
        state: 1,
        dealValue: 1,
        amountPaid: 1,
        pendingAmount: 1,
        bookingAmount: 1,
        isBookingAmount: 1,
        paymentStatus: 1,
        paymentMode: 1,
        verificationStatus: 1,
        transferApprovalStatus: 1,
        assignedTo: 1,
        invoiceUrl: 1,
        awbNumber: 1,
        effectiveDate: 1,
        dateStr: {
          $dateToString: { format: '%Y-%m-%d', date: '$effectiveDate', timezone: '+05:30' }
        },
        monthStr: {
          $dateToString: { format: '%Y-%m', date: '$effectiveDate', timezone: '+05:30' }
        }
      }
    }
  ];

  const filterMatch = {};
  if (date) filterMatch.dateStr = date;
  if (month) filterMatch.monthStr = month;

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filterMatch.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped, $options: 'i' } },
      { city: { $regex: escaped, $options: 'i' } }
    ];
  }

  if (Object.keys(filterMatch).length > 0) {
    pipeline.push({ $match: filterMatch });
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

  pipeline.push({
    $facet: {
      metadata: [{ $count: 'total' }],
      data: [
        { $sort: { effectiveDate: -1 } },
        { $skip: skip },
        { $limit: parseInt(limit, 10) },
        {
          $lookup: {
            from: 'users',
            localField: 'assignedTo',
            foreignField: '_id',
            as: 'salesPerson'
          }
        },
        {
          $unwind: {
            path: '$salesPerson',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            _id: 1,
            name: 1,
            phone: 1,
            email: 1,
            city: 1,
            state: 1,
            dealValue: 1,
            amountPaid: 1,
            pendingAmount: 1,
            bookingAmount: 1,
            isBookingAmount: 1,
            paymentStatus: 1,
            paymentMode: 1,
            verificationStatus: 1,
            transferApprovalStatus: 1,
            effectiveDate: 1,
            dateStr: 1,
            monthStr: 1,
            invoiceUrl: 1,
            awbNumber: 1,
            salesPersonName: '$salesPerson.name',
            salesPersonPhone: '$salesPerson.phone'
          }
        }
      ]
    }
  });

  const [result] = await Lead.aggregate(pipeline);
  const total = result?.metadata?.[0]?.total || 0;
  const leads = result?.data || [];

  return {
    total,
    page: parseInt(page, 10),
    totalPages: Math.ceil(total / limit),
    leads
  };
};
