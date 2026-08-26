import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const Lead = mongoose.model('Lead', new mongoose.Schema({
      isReassigned: Boolean,
      reassignedAt: Date,
      remarks: Array,
      updatedAt: Date,
      createdAt: Date,
    }, { timestamps: true, strict: false }));

    const reassignedLeads = await Lead.find({ isReassigned: true });
    console.log(`Found ${reassignedLeads.length} leads with isReassigned: true`);

    const bulkOps = [];

    for (const lead of reassignedLeads) {
      const reassignmentRemark = [...(lead.remarks || [])].reverse().find(
        r => r.note && r.note.includes('[Reassignment]')
      );

      const targetDate = reassignmentRemark?.createdAt || lead.updatedAt || lead.createdAt;

      bulkOps.push({
        updateOne: {
          filter: { _id: lead._id },
          update: { $set: { reassignedAt: targetDate } }
        }
      });
    }

    if (bulkOps.length > 0) {
      const res = await Lead.bulkWrite(bulkOps);
      console.log(`Successfully updated ${res.modifiedCount} leads with reassignedAt timestamps!`);
    }

    const verifyCount = await Lead.countDocuments({ isReassigned: true, reassignedAt: { $ne: null } });
    console.log(`Verification: ${verifyCount} out of ${reassignedLeads.length} leads have reassignedAt populated.`);

    process.exit(0);
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  }
}

migrate();
