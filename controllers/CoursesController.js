const Course = require('../models/course')
const Partner = require('../models/partner')
const { renderLanguageVersion, getAvailableTranslations } = require('./AbstractController')

module.exports.getCourses = async (req, res) => {
  try {
    const query = await getAvailableTranslations(req, res)
    const courses = await Course
      .find(query)
      .sort({order: 1})
      .exec()
    res.render('courses', { courses })
  } catch (err) {
    console.log(err)
  }
}

module.exports.getSingleCourse = async (req, res) => {
  const query = await getAvailableTranslations(req, res)
  const courseReq = Course.findOne({ slug: req.params.slug })
    .populate('language')
    .populate('languageVersion')
    .populate('locations')
    .populate('successStory')
    .exec()
  const partnersReq = Partner.find({ ...query }, 'link title partnerlogo is_alumni_employer')
    .sort('order')
    .exec({})
  const [course, partners] = await Promise.all([courseReq, partnersReq])
  const additionalPayload = { partners }
  renderLanguageVersion(req, res, course, 'course', 'courses', `slug`, additionalPayload)
}

module.exports.financingOptions = async (req, res) => {
    res.render('financingOptions')
}
