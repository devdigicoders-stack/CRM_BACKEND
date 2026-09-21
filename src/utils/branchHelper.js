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

/**
 * Calculate distance in kilometers between two lat/lng coordinates (Haversine Formula)
 */
export const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
  const numLat1 = Number(lat1);
  const numLon1 = Number(lon1);
  const numLat2 = Number(lat2);
  const numLon2 = Number(lon2);
  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return null;

  const R = 6371; // Earth radius in KM
  const dLat = ((numLat2 - numLat1) * Math.PI) / 180;
  const dLon = ((numLon2 - numLon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((numLat1 * Math.PI) / 180) *
      Math.cos((numLat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
};

/**
 * Rank branches by distance or location matching (PIN code / City / Distance)
 */
export const suggestNearestBranches = async ({ pinCode, city, state, latitude, longitude }) => {
  const branches = await Branch.find({ active: true }).populate('branchManager', 'name email phone').populate('assignedUsers', 'name email phone role');

  const scoredBranches = branches.map(branch => {
    let score = 0;
    let matchType = 'General';
    let distanceKm = null;

    // 1. PIN code match (Highest Priority)
    if (pinCode && branch.pincodes && branch.pincodes.includes(pinCode.toString().trim())) {
      score += 100;
      matchType = 'PIN Code Match';
    }

    // 2. City match
    if (city && branch.city && branch.city.toLowerCase().trim() === city.toLowerCase().trim()) {
      score += 50;
      if (matchType === 'General') matchType = 'City Match';
    }

    // 3. State match
    if (state && branch.state && branch.state.toLowerCase().trim() === state.toLowerCase().trim()) {
      score += 20;
      if (matchType === 'General') matchType = 'State Match';
    }

    // 4. Coordinates / Haversine distance
    if (latitude && longitude && branch.latitude && branch.longitude) {
      distanceKm = calculateHaversineDistance(latitude, longitude, branch.latitude, branch.longitude);
      if (distanceKm !== null) {
        if (distanceKm <= 15) score += 40;
        else if (distanceKm <= 50) score += 25;
        else if (distanceKm <= 100) score += 10;
      }
    }

    return {
      branch,
      score,
      matchType,
      distanceKm: distanceKm !== null ? distanceKm : 'N/A',
    };
  });

  // Sort descending by score, then ascending by distance
  scoredBranches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (typeof a.distanceKm === 'number' && typeof b.distanceKm === 'number') {
      return a.distanceKm - b.distanceKm;
    }
    return 0;
  });

  return scoredBranches;
};
