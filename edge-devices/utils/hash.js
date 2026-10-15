const crypto = require('crypto');

/**
 * 
 * @param {number} id - integer (1-100) for testing
 * @returns {string} - hash string
 */
function generatePalmHash(id) {
    const salt = "palmo_biometric_v1_";
    return crypto
        .createHash('sha256')
        .update(salt + id.toString())
        .digest('hex');
}

module.exports = { generatePalmHash };