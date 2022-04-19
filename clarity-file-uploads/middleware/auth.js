const authHelper = require('../helpers/auth');

/*
Adds an aclAuthentication property to the request.
If the auth token is valid, aclAuthentication will look like: 
{
  currentUserId: 'theuserid',
  token: 'theauthtoken',
  tokenData: {} // the data that was encoded in the token
}
If not authenticated, aclAuthentication will look like (code and message may vary) 
{
  errored: true, 
  code: 'UNAUTHENTICATED', 
  message: 'Unauthenticated'
}
*/
const verifyAuthentication = (req) => {
  let authResult = authHelper.verifyRequestAuthentication(req);

  req.aclAuthentication = authResult;

};


/*
Ends the request/response cycle if not authenticated. Behaves like verifyAuthentication if authenticated.
*/
const enforceAuthentication = (req, res) => {
  let authResult = authHelper.verifyRequestAuthentication(req);

  if (authResult.errored) {
    res.status(401).send({errored: true, message: 'Unauthenticated'});
    return;
  }

  req.aclAuthentication = authResult;

  return;
}

module.exports = {
  enforceAuthentication,
  verifyAuthentication
};
