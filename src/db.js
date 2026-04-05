const mysql = require("mysql2/promise");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const pool = mysql.createPool(connectionString);

module.exports = { pool };
