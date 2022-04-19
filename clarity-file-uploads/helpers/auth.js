const jwtHelper = require('@acl/jwt');

const verifyRequestAuthentication = (req) => {
    console.log(req.headers.authorization)
  let token = null;
  let tokenData = null;
  let authHeader = req.headers.authorization;
  let authParts = authHeader.split(' ');

  let errorObj = {
    errored: true, 
    code: 'UNAUTHENTICATED', 
    message: 'Unauthenticated'
  };

  if (authParts.length !== 2) {
    console.log(`Invalid or missing Authorization header: ${authHeader}`);
    return errorObj;
  }
  if (authParts[0].toLowerCase() !== 'bearer') {
    console.log(`Authorization header missing Bearer keyword: ${authHeader}`);
    return errorObj;
  }

  token = authParts[1];
  try {
    tokenData = jwtHelper.verifyToken(token);
    if (!tokenData) {
      return errorObj;
    }
  } catch (err) {
    return errorObj;
  }

  let currentUserId = tokenData.data.userId;

  return { currentUserId, token, tokenData };
};


module.exports = {
  verifyRequestAuthentication
};