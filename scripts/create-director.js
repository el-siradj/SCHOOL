require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../src/db");

(async () => {
  const full_name = "Director";
  const email = "director@school.local";
  const password = "12345678";
  const role = "DIRECTOR";

  const hash = await bcrypt.hash(password, 10);
  await pool.execute(
    "INSERT INTO users (full_name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)",
    [full_name, email, hash, role]
  );

  console.log("Created director:", email, "password:", password);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
