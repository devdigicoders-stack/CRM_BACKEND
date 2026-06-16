import mongoose from 'mongoose';
import { Lead } from './src/models/Lead.js';
import dotenv from 'dotenv';
dotenv.config();

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
    totalInstallations: 0, pendingInstallations: 0, completedInstallations: 0
  };
  
  const statusBreakdown = {};
  data.statusBreakdown.forEach(item => { statusBreakdown[item._id] = item.count; });
  
  return {
    totalLeads: totals.totalLeads || 0,
    totalInstallations: totals.totalInstallations || 0,
    pendingInstallations: totals.pendingInstallations || 0,
    completedInstallations: totals.completedInstallations || 0,
    statusBreakdown
  };
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthQuery = { createdAt: { $gte: startOfMonth } };
  
  const monthRes = await Lead.aggregate(generateAnalyticsPipeline(monthQuery));
  console.log('Month Data:', JSON.stringify(formatAnalyticsResult(monthRes), null, 2));
  
  process.exit(0);
}
run();
