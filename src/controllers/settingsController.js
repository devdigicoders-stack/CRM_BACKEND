import { Settings } from '../models/Settings.js';

// @desc    Get system settings
// @route   GET /api/v1/settings
// @access  Private
export const getSettings = async (req, res, next) => {
  try {
    let settings = await Settings.findOne().lean();
    if (!settings) {
      // Create defaults if not found
      settings = await Settings.create({});
    }
    res.status(200).json({
      status: 'success',
      data: {
        settings,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update system settings
// @route   PUT /api/v1/settings
// @access  Private (Super Admin and Admin only)
export const updateSettings = async (req, res, next) => {
  try {
    const { leadSources, leadTags, priorities, systemName } = req.body;

    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    if (leadSources) settings.leadSources = leadSources;
    if (leadTags) settings.leadTags = leadTags;
    if (priorities) settings.priorities = priorities;
    if (systemName) settings.systemName = systemName;
    settings.updatedBy = req.user.id;

    await settings.save();

    res.status(200).json({
      status: 'success',
      data: {
        settings,
      },
    });
  } catch (error) {
    next(error);
  }
};
