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
        ]
      }
    }
  ];
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await Lead.aggregate(generateAnalyticsPipeline({}));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
run();
