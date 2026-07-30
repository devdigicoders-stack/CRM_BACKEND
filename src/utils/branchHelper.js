import { Branch } from '../models/Branch.js';

/**
 * Gets the list of User/Admin ObjectIds assigned to the branch managed by the given manager,
 * including the manager's own ID.
 * @param {string|ObjectId} managerId 
 * @returns {Promise<Array<ObjectId>>}
 */
export const getBranchUserIds = async (managerId) => {
  const branch = await Branch.findOne({ branchManager: managerId }).select('assignedUsers');
  if (!branch) {
    return [managerId];
  }
  return [...branch.assignedUsers, managerId];
};
