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
    else res.redirect('/');
}

app.use((req, res, next) => {
    res.locals.user = req.session.user
    next();
});

// Set up Finnhub (https://finnhub.io/docs/api/quote)
const api_key = finnhub.ApiClient.instance.authentications['api_key'];
api_key.apiKey = process.env.API_KEY;
const finnhubClient = new finnhub.DefaultApi();

// Set up EJS
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
                    console.log('User logged in successfully')
                    res.redirect('/home')
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
            console.log('User logged out successfully')
            res.redirect('/')
        })
    })
})

app.get('/home', isAuthenticated, (req, res) => {
    // Query to get user's portfolio
    db.query('SELECT stock_symbol, SUM(quantity) AS sum FROM portfolios WHERE user_id = ? GROUP BY stock_symbol', [req.session.userID], (error, portfolioResults) => {
        if (error) {
            console.error(error);
        }
        // Query to get users transactions
        db.query('SELECT stock_symbol, quantity, price, transaction_type, transaction_date FROM portfolios WHERE user_id = ?', [req.session.userID], (err, transactionsResults) => {
            if (err) {
                console.error('Error displaying users transactions:', err);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
            res.render('home', { portfolio: portfolioResults, transactions: transactionsResults });
        })
    });
})

app.get('/sell', isAuthenticated, (req, res) => {
    const stockSymbol = req.query.symbol;
    const stockSum = req.query.sum;

    res.render('sell', { symbol: stockSymbol, sum: stockSum });
})

app.post('/sell', isAuthenticated, (req, res) => {
    // Get parameters
    const symbol = req.body.stock_symbol;
    const quantity = req.body.quantity;

    // Check if the user owns enough of the stock
    db.query('SELECT stock_symbol, SUM(quantity) as totalQuantity FROM portfolios WHERE user_id = ? GROUP BY stock_symbol HAVING stock_symbol = ? AND SUM(quantity) >= ?', [req.session.userID, symbol, quantity], (err, results) => {
        if (err) {
            console.error('Error checking if user owns stock:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        // Check if the user owns enough stock
        if (results.length > 0) {

            // Fetch current price of the stock
            finnhubClient.quote(symbol, (err, data, response) => {
                if (err) {
                    console.error('Error fetching stock price:', err);
                    return res.status(500).json({ error: 'Internal Server Error' });
                }

                const currentPrice = data.c;

                // Total price to deposit back to users account
                const totalPrice = parseFloat(quantity) * parseFloat(currentPrice);

                // Get the current date to store in db
                const currentDate = new Date().toISOString().split('T')[0];

                // Get user's current balance
                db.query('SELECT balance FROM users WHERE username = ?', [req.session.user], (err, results) => {
                    if (err) {
                        console.error('Error getting user balance:', err);
                        return res.status(500).json({ error: 'Internal Server Error' });
                    }

                    const currentBalance = parseFloat(results[0].balance);

                    // Add to user's balance
                    db.query('UPDATE users SET balance = ? WHERE username = ?', [currentBalance + totalPrice, req.session.user], (err, updateResults) => {
                        if (err) {
                            console.error('Error updating user balance:', err);
                            return res.status(500).json({ error: 'Internal Server Error' });
                        }

                        // Remove stock from user's portfolio with a negative quantity
                        db.query('INSERT INTO portfolios (user_id, stock_symbol, quantity, price, transaction_type, transaction_date) VALUES (?, ?, ?, ?, ?, ?)',
                            [req.session.userID, symbol, -quantity, currentPrice, 'sold', currentDate], (error, results) => {
                                if (error) {
                                    console.error('Error updating portfolio:', error);
                                    return res.status(500).json({ error: 'Internal Server Error' });
                                }
                                console.log('Stock sold successfully')
                                res.redirect('/home')
                            });
                        }
                    );
                });
            });
        }
        else {
            return res.status(400).json({ message: `User does not own ${quantity} shares of ${symbol}` });
        }
    });
})

app.post('/buy', isAuthenticated,  (req, res) => {
    // Get parameters
    const symbol = req.body.stock_symbol
    const quantity = req.body.quantity

    // Fetch current price of stock
    finnhubClient.quote(symbol, (err, data, response) => {
        if (err) {
            console.error('Error:', err);
            return res.status(500).json({error: 'Internal Server Error'});
        }

        const currentPrice = data.c;

        // Check if stock exists
        if (currentPrice === 0) {
            return res.status(400).json({message: 'Stock does not exist'});
        }

        // Total price of users purchase
        const totalPrice = parseFloat(quantity) * parseFloat(currentPrice);

        // Get the current date to store in db
        const currentDate = new Date().toISOString().split('T')[0];

        // Get users current balance
        db.query('SELECT balance FROM users WHERE username = ?', [req.session.user], (err, results) => {
            if (err) {
                console.error('Error getting users balance:', err);
                return res.status(500).json({error: 'Internal Server Error'});
            }
            else {
                const currentBalance = parseFloat(results[0].balance);

                // Check if user can afford to buy
                if (currentBalance >= totalPrice) {

                    // Subtract from users balance
                    db.query('UPDATE users SET balance = ? WHERE username = ?', [currentBalance - totalPrice, req.session.user], (err, updateResults) => {
                        if (err) {
                            console.error('Error subtracting from users account when buying stock:', err);
                            return res.status(500).json({error: 'Internal Server Error'});
                        }
                        else {

                            // Insert stock into users portfolio
                            db.query('INSERT INTO portfolios (user_id, stock_symbol, quantity, price, transaction_type, transaction_date) VALUES (?, ?, ?, ?, ?, ?)',
                                [req.session.userID, symbol, quantity, currentPrice, 'bought', currentDate], (error, results) => {
                                    if (error) {
                                        console.error('Error inserting bought stock to users account:', err);
                                        return res.status(500).json({error: 'Internal Server Error'});
                                    }
                                    else {
                                        console.log('Stock bought successfully')
                                       res.redirect('/home')
                                    }
                                })
                        }
                    })
                }
                else {
                    return res.status(500).json({error: 'User cannot afford to buy'});
                }
            }
        });
    })
})

app.get('/account', isAuthenticated, (req, res) => {
    db.query('SELECT balance FROM users WHERE username = ?', [req.session.user], (err, results) => {
        if (err) {
            console.error('Error getting users balance:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        res.render('account', {userBalance: parseFloat(results[0].balance)})
    })
})

app.post('/deposit', isAuthenticated, (req, res) => {
    // Get parameter
    const addedAmount = parseFloat(req.body.deposit);

    // Get users current balance
    db.query('SELECT balance FROM users WHERE username = ?', [req.session.user], (err, results) => {
        if (err) {
            console.error('Error getting users balance:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        else {
            const currentBalance = parseFloat(results[0].balance);

            // Update users balance
            db.query('UPDATE users SET balance = ? WHERE username = ?', [currentBalance + addedAmount, req.session.user], (err, updateResults) => {
                if (err) {
                    console.error('Error:', err);
                    return res.status(500).json({ error: 'Internal Server Error' });
                }
                else {
                    console.log('Deposit successful')
                    res.redirect('/account')
                }
            })
        }
    })
})

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});