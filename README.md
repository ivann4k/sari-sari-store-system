# Sari-Sari Store and Sales Management System

Final Project for ITPC 103 & ITPE 101

A web-based system built with Node.js, Express, and MySQL that helps a sari-sari store owner manage inventory, record sales, and view daily sales reports. It works on phones and computers.

## Group Members

- Jonahdi S. Capuy
- Ar-fayzee N. Alfad
- Brent Kerby A. Baya
- Eryll Joycee E. Luna
- Ivan Jessy C. Tinaytina
- Norhan C. Ibnohasim

**Section:** BS IT 2A
**Group Name:** Group 4

## Requirements

- Node.js 18 or newer and npm
- MySQL 8 or MariaDB (for example, through XAMPP)

## Setup

1. Copy `server/.env.example` to `server/.env` and set your MySQL username and password.
2. Create the database once (change `root` if your MySQL user is different):

```
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS sarisari CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

3. Install dependencies and start the server:

```
cd server
npm install
npm run dev
```

4. Open http://localhost:5000 in your browser. The server also serves the web interface in the `client` folder.

The server creates the required tables from `server/src/db/schema.sql` when it starts. The database user needs permission to create tables. Never commit your `.env` file.

## Features

**Inventory Management**
- Add, search, edit, and delete products
- Restock products
- Low stock warning (stock of 5 or less)

**Sales Management**
- Build a cart with multiple products
- Automatic total and change computation
- Stock is deducted automatically after every sale
- Sales are blocked when stock is not enough or payment is too low
- Daily sales report (transactions, items sold, income)
- Recent sales history

## API

- `GET /api/health` - API process health
- `GET /api/products?q=` - list or search products
- `POST /api/products` - add a product
- `PUT /api/products/:id` - update a product's name and price
- `PATCH /api/products/:id/restock` - add stock
- `DELETE /api/products/:id` - delete a product
- `POST /api/sales` - record a sale (items and payment); runs as a database transaction
- `GET /api/sales` - recent sales
- `GET /api/reports/daily?date=YYYY-MM-DD` - daily report

## Project Structure

```
sari-sari-store-system/
  client/index.html        web interface
  server/src/index.js      Express API
  server/src/db/schema.sql database tables
  server/.env.example      sample settings
  README.md
```

## Verify

```
cd server
npm test
```
