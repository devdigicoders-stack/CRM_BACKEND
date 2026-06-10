import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema(
  {
    leadSources: {
      type: [String],
      default: ['Direct', 'Facebook Ads', 'Google Ads', 'Website', 'Reference', 'Cold Calling'],
    },
    leadTags: {
      type: [String],
      default: ['new', 'interested', 'not_interested', 'follow-up', 'hot', 'warm', 'cold'],
    },
    priorities: {
      type: [String],
      default: ['high', 'medium', 'low'],
    },
    systemName: {
      type: String,
      default: 'Sales Management CRM',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

export const Settings = mongoose.model('Settings', settingsSchema);
