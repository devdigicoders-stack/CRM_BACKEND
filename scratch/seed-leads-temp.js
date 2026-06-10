import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb+srv://devdigicoders_db_user:gAhv5kBGSLOs9wXf@crm.yiedjpz.mongodb.net/crmCRM?appName=CRM';
const installerId = '6a2912d48e4acd0503b596ca';

// Lead Schema definition to match database structure
const leadSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  source: { type: String, default: 'Direct' },
  status: { type: String, default: 'new' },
  priority: { type: String, default: 'medium' },
  transferredToInstallation: { type: Boolean, default: false },
  productDetails: String,
  dealValue: { type: Number, default: 0 },
  installationRep: mongoose.Schema.Types.ObjectId,
  installationStatus: { type: String, default: 'assigned' },
  installationProgressRemarks: String,
  installationProofUrl: String,
  installationIssueReported: { type: Boolean, default: false },
  installationIssueRemarks: String,
  expectedDeliveryDate: Date,
  createdBy: mongoose.Schema.Types.ObjectId,
  remarks: [{
    note: String,
    addedBy: mongoose.Schema.Types.ObjectId,
    createdAt: { type: Date, default: Date.now }
  }]
}, { collection: 'leads', timestamps: true });

const Lead = mongoose.model('Lead', leadSchema);

async function run() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB!');

    // Clear existing mock leads first to avoid duplicates if re-running
    const deleteResult = await Lead.deleteMany({ installationRep: installerId });
    console.log(`Cleared ${deleteResult.deletedCount} old mockup leads`);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const mockLeads = [
      {
        name: 'Amit Sharma',
        phone: '9876543210',
        email: 'amit.sharma@example.com',
        source: 'Website',
        status: 'converted',
        priority: 'high',
        transferredToInstallation: true,
        productDetails: 'Flat 402, Sector 62, Noida - Split AC 1.5 Ton Installation',
        dealValue: 24500,
        installationRep: installerId,
        installationStatus: 'assigned',
        expectedDeliveryDate: tomorrow,
        createdBy: installerId,
        remarks: [
          {
            note: 'Lead verified and transferred to Installation Team.',
            addedBy: installerId
          }
        ]
      },
      {
        name: 'Priya Patel',
        phone: '9123456789',
        email: 'priya.patel@example.com',
        source: 'Reference',
        status: 'converted',
        priority: 'medium',
        transferredToInstallation: true,
        productDetails: 'House 14, Koramangala 3rd Block, Bangalore - Solar Panel Setup',
        dealValue: 85000,
        installationRep: installerId,
        installationStatus: 'in_progress',
        installationProgressRemarks: 'Mounting brackets fixed. Wiring connection in progress.',
        expectedDeliveryDate: nextWeek,
        createdBy: installerId,
        remarks: [
          {
            note: 'Installation started. Brackets successfully fixed.',
            addedBy: installerId
          }
        ]
      },
      {
        name: 'Rajesh Kumar',
        phone: '9988776655',
        email: 'rajesh.kumar@example.com',
        source: 'Direct',
        status: 'converted',
        priority: 'low',
        transferredToInstallation: true,
        productDetails: 'Shop 105, Mall Road, Shimla - Fiber Router & CCTV Setup',
        dealValue: 12000,
        installationRep: installerId,
        installationStatus: 'completed',
        installationProgressRemarks: 'Setup completed. All 4 cameras verified and live feed configured.',
        installationProofUrl: '/uploads/proofs/proof-mock.jpg',
        expectedDeliveryDate: yesterday,
        createdBy: installerId,
        remarks: [
          {
            note: 'CCTV installation completed successfully. Feed checked on customer mobile app.',
            addedBy: installerId
          }
        ]
      }
    ];

    console.log('Inserting mockup leads...');
    const result = await Lead.insertMany(mockLeads);
    console.log('✅ Mock leads inserted successfully:', result.map(l => l.name));

  } catch (error) {
    console.error('❌ Error seeding leads:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('Database disconnected.');
  }
}

run();
