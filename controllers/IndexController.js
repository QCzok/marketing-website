const Story = require('../models/story')
const Contact = require('../models/contact')
const Course = require('../models/course')
// const Event = require('../models/event')
const Location = require('../models/location')
const Partner = require('../models/partner')
const Employee = require('../models/employee')
const Setting = require('../models/setting')
const request = require('request')
const requestPromise = require("request-promise");
const { sendMail, getAsyncRedis, getFbClid } = require('../helpers/helper')
const { getAvailableTranslations } = require('./AbstractController')
const fetchEventsByLocation = require("../helpers/fetch_events_by_location");
let redisClient = null;
const reqComesFromCoursePage = (req) => {
  return /\/courses\/\w*/.test(req.headers.referer)
}
module.exports.landingpage = async (req, res) => {

  let indexData = null
  try {
    if (process.env.USE_REDIS !== undefined && process.env.USE_REDIS === 'true') {
      // console.log('Redis enabled')
      redisClient = getAsyncRedis()
    } else if (process.env.USE_REDIS === 'false') {
      // console.log('Redis disabled')
    } else {
      console.error('USE_REDIS is not defined in .env')
      process.exit()
    }
    if (process.env.USE_REDIS === 'true') {
      try {
        const getNavData = await redisClient.getAsync(`indexData${req.session.locale}`)
        indexData = JSON.parse(getNavData)

      } catch (error) {
        console.error('Redis ERROR: Could not get IndexController data: ' + error)
      }
    }
    if (indexData === null) {
      let query = await getAvailableTranslations(req, res)
      const stories = Story
        .find({ ...query })
        .sort('order')
        .exec({})
      const partners = Partner.find({ ...query }, 'link title partnerlogo is_alumni_employer')
        .sort('order')
        .exec({})
      const courses = Course
        .find(query, 'icon headline slug subheading courselength')
        .sort({ order: 1 })
        .exec()
      indexData = await Promise.all([stories, partners, courses])
      const events = await fetchEventsByLocation(true, res.locals.settings.landingpage_number_events);
      indexData.push(events)
      if (process.env.USE_REDIS === 'true') {
        try {
          await redisClient.setAsync(`indexData${req.session.locale}`, JSON.stringify(indexData))
        } catch (error) {
          console.error('Redis ERROR: Could not save IndexController data: ' + error)
        }
      }
    }
    const [storiesRes, partnersRes, coursesRes, events] = indexData;

    res.render('index', {
      events,
      stories: storiesRes,
      partners: partnersRes,
      courses: coursesRes
    })
  } catch (err) {
    console.log(err)
  }
}
module.exports.contactLocations = async (req, res) => {
  const locations = await Location.find({}).populate('contactEmployee').sort({ order: 1 }).exec();
  const sortedEmployees = locations.map(l => l.contactEmployee.sort((a, b) => a.order - b.order))
  locations.contactEmployee = sortedEmployees
  const contact = req.body
  res.render('contactLocations', {
    locations,
    contact
  })
};
module.exports.contact = async (req, res, next) => {
  const { firstname, lastname, email, age_field, body, phone, locations, sendaltemail, TermsofService, afa_jc_registered_, form_are_you_currently_unemployed } = req.body
    if (age_field) {
      console.log('Bot stepped into honeypot!')
      if (req.headers['content-type'] === 'application/json') {
        const response = {
          message: res.__(`Thanks for your message`)
        }
        return res.json({
          response
        })
      } else {
        req.flash(
          'success',
          res.__(`Thanks for your message`)
        );
        res.redirect(req.headers.referer)
      }
      next()
      return;
    }
  var emptyFields = Object.entries(req.body).filter(([key, value]) => typeof value === "string" && value.trim() === "").map(a => a[0]).filter(a => !["nb-transaction-token", "nb-confirmation-token", "age_field"].includes(a))
  if (emptyFields.length > 0 || !email || !TermsofService) {
      if (req.headers['content-type'] === 'application/json') {
        const response = {
          error: res.__(`Some fields are invalid or empty: ${emptyFields.map(a => `${a}, `)}`),
        }
        return res.json({
          response
        })
      } else {
        req.flash('danger', res.__(`Some fields are invalid or empty: ${emptyFields.map(a => `${a}, `)}`))
        res.redirect(req.headers.referer)
        next()
        return
      }
    }
    let courseReq
    if (reqComesFromCoursePage(req)) {
      var requestString = new URL(req.headers.referer)
      var courseSlug = requestString.pathname.substring(requestString.pathname.lastIndexOf('/') + 1)
      courseReq = Course.findOne({ slug: courseSlug }, 'curriculumPdf')
    }
    const contact = new Contact()
    contact.firstname = firstname
    contact.lastname = lastname
    contact.email = email
    if (phone) {
      contact.phone = phone.replace(/[a-z]/g, '')
    }
    contact.track = req.headers.referer
    contact.body = body
    contact.jobcenter = afa_jc_registered_
    contact.unemployed = form_are_you_currently_unemployed
    if (req.session.utmParams) {
      contact.utm_params = req.session.utmParams
    }
    contact.createdAt = new Date()
    contact.isCompany = sendaltemail
    contact.locations = locations
    if (!contact.email) {
      res.redirect(req.headers.referer)
    }
    const location = await Location.findById(locations)
    const mailTemplate = `Contact from: <table>
    <tr>
      <td>Message send from: </td>
      <a href=${req.headers.referer}>${req.headers.referer}</a>
   </tr>
    <tr>
      <td>Name: </td>
      <td>${firstname} ${lastname}</td>
    </tr>
    <tr>
      <td>Phone: </td>
      <td>${phone}</td>
    </tr>
    <tr>
      <td>Email: </td>
      <td>${email}</td>
    </tr>
    ${!sendaltemail && `<tr>
      <td>Is registered at Jobcenter:</td>
      <td>${afa_jc_registered_}</td>
    </tr><tr>
      <td>Is unemployed:</td>
      <td>${form_are_you_currently_unemployed}</td>
    </tr>`}
    <tr>
      <td>Content: </td>
      <td>${body}</td>
    </tr>
    ${locations && `<tr> <td>Locations: </td> <td>${location.name}</td> </tr>`}
    </table>
  `
    const settings = await Setting.findOne()

    const mailOptions = {
      from: 'contact@digitalcareerinstitute.org',
      to: ['localhost', 'staging'].some(el => req.headers.host.includes(el))
        ? process.env.MAILRECEIVER
        : sendaltemail
          ? settings.tourmailreceiver
          : settings.mailreceiver,
      subject: sendaltemail
        ? 'Company Tour request from website'
        : 'Message on website',
      text: mailTemplate,
      html: mailTemplate
    }
    let hubspotPromise = new Promise(() => { })

    let remainingUtmParams = req.session.utmParams ? { ...req.session.utmParams } : []
    let properties

    if (!!process.env.HUBSPOT_API_KEY) {
      let fbclid = getFbClid(req, res, next);
      properties = [
        { property: 'hs_facebook_click_id', value: fbclid },
        {
          property: 'form_payload',
          value: JSON.stringify({
            'track': req.headers.referer,
            'locations': location,
            'body': body,
            'is_company': sendaltemail,
            'utm_params': remainingUtmParams,
            'all_fields': req.body
          })
        }
      ];
      const filteredPayload = Object.keys(req.body).reduce((acc, v) => {
        if (![
          "age_field",
          "nb-confirmation-token",
          "nb-result",
          "nb-transaction-token",
          "termsofservice",
          "sendaltemail",
          "track",
          "locations",
          "body",
        ].map(i => i.toLowerCase()).includes(v.toLowerCase())) {
          if (req.body[v].trim() !== '') {
            acc[v] = req.body[v]
          }
        }
        return acc
      }, {})
  
      Object.keys(filteredPayload).map(i => properties.push({ property: i, value: filteredPayload[i] }))

      if(location){
        properties.push({property: 'state_de_', value: location.name } )  
      }
      if(req.session.utmParams && req.session.utmParams.utm_source){
        properties.push({property: 'utm_source', value: req.session.utmParams.utm_source} ) 
      }
      if(req.session.utmParams && req.session.utmParams.utm_medium){
        properties.push({property: 'utm_medium', value: req.session.utmParams.utm_medium} ) 
      }
      if(req.session.utmParams && req.session.utmParams.utm_campaign){
        properties.push({property: 'utm_campaign', value: req.session.utmParams.utm_campaign} ) 
      }
      if(req.session.utmParams && req.session.utmParams.utm_content){
        properties.push({property: 'utm_content', value: req.session.utmParams.utm_content} ) 
      }
      if(req.session.utmParams && req.session.utmParams.utm_term){
        properties.push({property: 'utm_term', value: req.session.utmParams.utm_term} ) 
      }

      var options = {
        method: 'POST',
        url: `https://api.hubapi.com/contacts/v1/contact/createOrUpdate/email/${email}`,
        qs: { hapikey: process.env.HUBSPOT_API_KEY },
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          properties: properties,
        },
        json: true
      };
      hubspotPromise = requestPromise(options)
    }
    contact.properties = properties
    const contactSavepromise = contact.save()
    // TODO remove logging statement
  console.log("req.session", req.session);
  console.log("req.body", req.body);
  console.log("options.body.properties", options.body.properties);
    // to save time, mail get send out without waiting for the response
    const info = sendMail(res, req, mailOptions)
  try {
    const result = await Promise.all([hubspotPromise, contactSavepromise])
    console.log('### Result of 1st hubspotPromise', JSON.stringify(result));
    finish(res, req, contact)
  } catch (e) {
    console.error(`### Error 2nd catch`, e.message)
    try {
      const filteredOptions = options.body.properties
      e.error.validationResults.map((missingP => {
        filteredOptions.splice(filteredOptions.findIndex(i => i.property === missingP.name), 1)
      }))
      console.log(`### Try a second HS request without invalid properties: ${JSON.stringify(e.error.validationResults.map(i => i.name))}`)
      const errorMailOptions = {
        from: 'admin@digitalcareerinstitute.org',
        to: settings.adminreceiver.split(','),
        subject: 'Failed Hubspot request',
        html: `Broken fields ${JSON.stringify(e.error.validationResults.map(i => i.name))}, <br/><br/><br/>Request body:<br/> <code style="500px">${JSON.stringify(req.body).replace('", "', '",<br/><br/><br/>"')} </code><br/><br/><br/>Session:<br/><code>${JSON.stringify(req.session)}</code><br/><br/><br/>Properties: <br/><code>${JSON.stringify(req.session)}</code><br/><br/><br/>`,
        text: `Broken fields ${JSON.stringify(e.error.validationResults.map(i => i.name))}, Request body: ${JSON.stringify(req.body)}`,
      }
      const info = sendMail(res, req, errorMailOptions)
      options.body.properties = filteredOptions
      const hubspotPromise2 = await requestPromise(options)
      console.log('### Result of 2nd hubspotPromise', hubspotPromise2);
    if (req.headers['content-type'] === 'application/json') {
      const response = {
        message: res.__(`Thanks for your message`),
        contact_id: contact.id
      }
      let course
      if (reqComesFromCoursePage(req)) {
        course = await courseReq
        if (course) {
          response.curriculumPdf = course.curriculumPdf
        }
      }
      delete req.session.utmParams
      return res.json({
        response
      })
    } else {
      req.flash('danger', 'Please fill out all form fields')
      res.redirect(req.headers.referer)
      finish(res, req, contact, courseReq)
    }
  } catch (e) {
      finish(res, req, contact, courseReq)
      console.error("### Error 1st catch", e.message)
    }
  }
}
const finish = async (res, req, contact, courseReq) => {
    if (req.headers['content-type'] === 'application/json') {
      const response = {
        message: res.__(`Thanks for your message`),
        contact_id: contact.id
      }
      let course
      if (reqComesFromCoursePage(req)) {
        course = await courseReq
        if (course) {
          response.curriculumPdf = course.curriculumPdf
        }
      }
      return res.json({
        response
      })
    } else {
      req.flash(
        'success',
        res.__(`Thanks for your message`)
      );
      res.redirect(req.headers.referer)
  }
  delete req.session.utmParams
  next()
}
module.exports.tour = async (req, res) => {
  try {
    const query = await getAvailableTranslations(req, res)
    const partners = await Partner.find(query)
      .exec();
    res.locals.title = 'Become our Hiring Partner | Digital Career Institute'
    res.render('tour', { companytour: true, partners })
  } catch (err) {
    console.log(err)
  }
}
module.exports.newsletter = (req, res) => {
  const { email } = req.body

  // Make sure fields are filled
  if (!email) {
    return res.status(422).json({
      code: 422,
      message: 'No valid email address given!'
    })
  }

  // Construct req data
  const data = {
    members: [
      {
        email_address: email,
        status: 'pending'
        // merge_fields: {}
      }
    ]
  }

  try {
    const postData = JSON.stringify(data)

    const options = {
      url: process.env.URL,
      method: 'POST',
      headers: {
        Authorization: process.env.AUTHORIZATION
      },
      body: postData
    }

    request(options, (err, response) => {
      if (err) {
        return res.json({
          code: response.statusCode,
          message: err.message
        })
      } else {
        const json = JSON.parse(response.body)
        if (response.statusCode === 200 && json.errors.length === 0) {
          return res.status(200).json({
            code: 200,
            message: 'Successfully subscribed to the newsletter!'
          })
        } else {
          return res.status(422).json({
            code: json.errors ? 422 : response.statusCode,
            message: json.errors
          })
        }
      }
    })
  } catch (err) {
    console.log(
      `A error occured in the newsletter subscription route \n\n ${err}`
    )
  }
}

module.exports.jobcenter = async (req, res) => {
  try {
    let query = await getAvailableTranslations(req, res)
    const storiesQuery = Story
      .find({ ...query })
      .sort('order')
      .exec({})
    const employeeQuery = Employee
      .find({
        ...query,
      }).populate('locations')
      .exec()
    const locationsQuery = Location.find({ contactEmployee: { $exists: 1 } })
      .populate('contactEmployee')
      .sort({ order: 1 })
      .exec()
    const partnersQuery = Partner.find({ ...query })
      .sort('order')
      .exec({})

    const coursesQuery = Course
      .find(query)
      .sort({ order: 1 })
      .exec()
    indexData = await Promise.all([storiesQuery, locationsQuery, partnersQuery, coursesQuery, employeeQuery])

    let [stories, locations, partners, courses, employees] = indexData;
    res.render('jobcenter', {
      stories,
      locations,
      partners,
      courses,
      employees
    })
  } catch (err) {
    console.log(err)
    res.redirect(req.headers.referer)
  }
}
module.exports.thankYou = async (req, res) => {
  try {
    const page = req.path.replace('/', ' ')
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      const matchinContactRequest = await Contact.findById(req.params.id)
      if (matchinContactRequest) {
        res.locals.title = 'Thank you | Digital Career Institute'
        res.setHeader("X-Robots-Tag", "noindex, follow");
        res.render('thankyou', matchinContactRequest)
      } else {
        return res.render('404', {
          page: page
        })
      }
    } else {
      return res.render('404', {
        page: page
      })
    }
  } catch (err) {
    console.log(err)
    res.redirect('/')
  }
}

module.exports.signupCourse = async (req, res, next) => {
  let query = await getAvailableTranslations(req, res)
  const partners = await Partner.find({ ...query }, 'link title partnerlogo is_alumni_employer')
    .sort('order')
    .exec({})
  return res.render('signup', {
    partners,
    path: req.url.replace(/\/(.*)\//gm, "$1").replace(/(\w*)\//gm, "$1").replace("/", '-')
  })
}