const express = require('express');
const finnhub = require('finnhub');
const path = require('path');
const mysql = require("mysql2");
const cors = require("cors");
const session = require('express-session');
require('dotenv').config();
const app = express();
const PORT = 3000;
app.use(cors());

// Serve static (CSS) files
app.use(express.static(path.join(__dirname, '../public')));

// MySQL database connection
const db = mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
});

// Use sessions to keep track of user login state
// // https://expressjs.com/en/resources/middleware/session.html
app.set('trust proxy', 1) // trust first proxy
app.use(session({
    secret: 'keyboard cat',
    resave: false,
    saveUninitialized: true
}))

// middleware to test if authenticated
function isAuthenticated(req, res, next) {
    if (req.session.user) next();
    else res.redirect('/login');
}

// Set up the Finnhub API key
// https://finnhub.io/docs/api/quote
const api_key = finnhub.ApiClient.instance.authentications['api_key'];
api_key.apiKey = "clfk521r01qovepqafvgclfk521r01qovepqag00"; // API Key is free
const finnhubClient = new finnhub.DefaultApi();

// Setup EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.render('index')
})

app.get('/stock', (req, res) => {
    // Get query parameters
    const symbol = req.query.symbol;

    // Check if symbol is provided
    if (!symbol) {
        return res.render('stock', {symbol: "", stock: ""});
    }

    // Fetch stock information
    finnhubClient.quote(symbol, (error, data, response) => {
        if (error) {
            console.error('Error:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        // Return JSON response
        res.render('stock', {symbol: symbol, stock: data});
    });
})

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});