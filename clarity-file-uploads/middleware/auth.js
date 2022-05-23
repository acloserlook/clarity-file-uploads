const authHelper = require('../helpers/auth');

/*
Ends the request/response cycle if not authenticated. Behaves like verifyAuthentication if authenticated.
*/
const enforceAuthentication = (req) => authHelper.verifyRequestAuthentication(req);

module.exports = {
  enforceAuthentication
};
