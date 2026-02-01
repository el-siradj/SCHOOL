const crypto = require("crypto");

function requestId(req, res, next) {
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  req.request_id = id;
  res.setHeader("x-request-id", id);
  next();
}

module.exports = { requestId };
