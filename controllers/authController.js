const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Email = require('../utils/email');
const path = require('path');


const signToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
};


exports.signUp = async (req, res, next) => {
    try {
        const newUser = await User.create(req.body);
        const url = `${req.protocol}://${req.get('host')}/`;
        await new Email(newUser, url).sendWelcome();

        const token = signToken(newUser._id);
        const cookieOptions = {
            expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000),
            secure: true,
            httpOnly: false,
            // sameSite:'none'
        }

        res.cookie('jwt', token, cookieOptions);

        res.status(201).json({
            status: 'Success',
            message: 'New user created !',
            token,
            data: {
                user: newUser
            }
        })
    } catch (err) {
        res.status(404).json({
            status: err.status,
            message: err.message
        })
    }
};

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(404).json({
                status: 'Fail',
                message: 'Please provide both Email and Password !'
            });
        }
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({
                status: 'fail',
                message: 'User Not Found',
            })
        };


        const correct = await user.correctPassword(password, user.password);
        if (!correct) {
            return res.status(401).json({
                status: 'fail',
                message: 'Invalid Password'
            });
        };

         //check the deactivation status
         if (!user.activate) {
            return res.status(401).json({
                status: 'Fail',
                message: 'You account has be deactivated or deleted please contact administrator'
            })
        }


        const token = signToken(user._id);
        cookieOptions = {
            expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000),
            secure: true,
            httpOnly: false
        }

        res.cookie('jwt', token, cookieOptions);
        res.status(200).json({
            status: 'Success',
            message: 'User Login Successfully',
            token,
        })

    } catch (err) {
        res.status(500).json({
            status: err.status,
            message: err.message
        });
    }
};

exports.protect = async (req, res, next) => {
    try {
        let token;

        //for the development
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {// define the query authorization and token in headers
            token = req.headers.authorization.split(' ')[1];
        }


        // for production
        // const parseCookies = (cookieHeader) => {
        //     const cookies = {};
        //     if (cookieHeader) {
        //         cookieHeader.split(';').forEach(cookie => {
        //             const [name, value] = cookie.split('=');
        //             cookies[name.trim()] = decodeURIComponent(value);
        //         });
        //     }
        //     return cookies;
        // };
        // // Manually parse cookies
        // const cookies = parseCookies(req.headers.cookie);
        // console.log('Parsed Cookies:', cookies);

        // // Access the JWT token
        // if (cookies.jwt) {
        //     token = cookies.jwt;
        // }


        // if (req.cookies.jwt) {
        //     token = req.cookies.jwt
        // }


        if (!token) {
            return res.status(401).json({
                status: 'fail',
                message: 'Your are not logged In. Please Log in'
            });
        }

        const decoded = jwt.verify(token,process.env.JWT_SECRET);

        const currentUser = await User.findById(decoded.id);
        
        console.log(currentUser);

        if (!currentUser) {
            return res.status(401).json({
                status: 'fail',
                message: 'The user belonging to this token in no longer exists'
            });
        }

        if (currentUser.passwordChangedAfter(decoded.iat)) {
            return res.status(401).json({
                status: 'fail',
                message: 'User recently changed the password'
            });
        }

        req.user = currentUser;
        next();
    } catch (err) {
        res.status(500).json({
            status: 'fail',
            message: err.message
        })
    }
};


exports.restrictTo = (...roles) => {
    return (res, req, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(401).json({
                status: 'fail',
                message: 'You dont have permission to perform this action !'
            });
        }
        next();
    }
};





exports.forgotPassword = async (req, res, next) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'There is no user with tha Email',
            });
        }

        const resetToken = user.createPasswordResetToken();
        console.log(resetToken);
        await user.save({ validateBeforeSave: false });


        try {
            const resetURL = `${req.protocol}://localhost:5173/resetPassword/${resetToken}`;
            await new Email(user, resetURL).sendPasswordReset();
            res.status(200).json({
                status: 'Success',
                message: 'reset link has been send to mail'
            });

        } catch (error) {
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save({ validateBeforeSave: false });

            return res.status(500).json({
                status: 'fail',
                message: error.message
            })

        }

    } catch (error) {
        return res.status(500).json({
            status: 'fail',
            message: error.message || 'Something went Wrong'
        });
    }
};


exports.resetPassword = async (req, res, next) => {
    try {
        const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
      
        console.log(hashedToken)

        const user = await User.findOne({
            passwordResetToken:hashedToken,
            passwordResetExpires:{$gt:Date.now()}
        });

        if(!user){
            throw Error('Token is Invalid or has been Expired !');
            next();
        }

        user.password=req.body.password;
        user.passwordConfirm=req.body.passwordConfirm;
        user.passwordResetExpires=undefined;
        user.passwordResetToken=undefined;
        await user.save();

        const token=signToken(user._id);
        const cookieOptions={
            expires:new Date(Date.now()+process.env.JWT_COOKIE_EXPIRES_IN*24*60*60*1000),
            secure:true,
            httpOnly:true
        }

        res.cookie('jwt',token,cookieOptions);
        res.status(201).json({
            status:'Success',
            token
        })

    } catch (err) {
         return res.status(500).json({
            status:'fail',
            message:err.message||'Something went Wrong'
         });
    }
};


exports.updateCurrentUserPassword = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id).select('+password');
        

        if (!await user.correctPassword(req.body.passwordCurrent, user.password)) {
            return res.status(401).json({
                status: 'fail',
                message: 'Incorrect current password.'
            });
        }
        user.password = req.body.password;
        user.passwordConfirm = req.body.passwordConfirm;
        await user.save();

        const token = signToken(user._id);
        const cookieOptions = {
            expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000),
            secure: true,
            httpOnly: true
        }
        res.cookie('jwt', token, cookieOptions);
        res.status(200).json({
            status: 'Success',
            token
        });

    } catch (error) {
        res.status(500).json({
            status: 'Fail',
            message: error.message
        });
    }
}


exports.clearCookieLogout=(req,res,next)=>{
    res.clearCookie('jwt',{path:'/'});
    res.status(200).json({
        status:'Success',
        message:'Logged out Successfully'
    })
}



