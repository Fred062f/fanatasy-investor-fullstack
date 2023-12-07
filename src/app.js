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
api_key.apiKey = process.env.API_KEY;
const finnhubClient = new finnhub.DefaultApi();

// Setup EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Routes
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

app.get('/register', (req, res) => {
    res.render('register')
})

app.post('/register', (req, res) => {
    // Get body parameters
    const username = req.body.username;
    const password = req.body.password;

    // Insert user into the database
    db.query('INSERT INTO users (username, password, balance) VALUES (?, ?, ?)', [username, password, 10000], (err, results) => {
        if (err) {
            console.error('Error registering user:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        console.log('User registered successfully')
        res.render('index')
    });
})

app.post('/login', (req, res) => {
    // Get body parameters
    const username = req.body.username;
    const password = req.body.password;

    // Check user credentials
    db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
        if (err) {
            console.error('Error logging in user:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        // If user exists
        if (results.length > 0) {

            // Regenerate the session to guard against session fixation
            req.session.regenerate(function (err) {
                if (err) return next(err);

                // Store user information in the session
                req.session.user = results[0].username;
                req.session.userID = results[0].id;

                // Save the session before redirection
                req.session.save(function (err) {
                    if (err) return next(err);
                    console.log('User logged in succesfully')
                    res.render('stock', {symbol: "", stock: ""})
                })
            })
        }
    })
})

app.get('/logout', function (req, res, next) {
    // logout logic

    // clear the user from the session object and save.
    // this will ensure that re-using the old session id
    // does not have a logged in user
    req.session.user = null
    req.session.save(function (err) {
        if (err) next(err)

        // regenerate the session, which is good practice to help
        // guard against forms of session fixation
        req.session.regenerate(function (err) {
            if (err) next(err)
            res.redirect('/')
        })
    })
})

// Push

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});