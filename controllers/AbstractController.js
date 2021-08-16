const mongoose = require("mongoose");
const Language = require("../models/language");
module.exports.renderLanguageVersion = async (req, res, model, singlePath, path, identifier = `slug`, additionalPayload = undefined) => {
  if (!!model && !!model.language && model.language.title !== 'en' && !req.session.locale) {
    res.redirect(`/${path}/${model.languageVersion[identifier]}`)
  } else if (!!model && !!model.languageVersion && !!req.session.locale && model.language.title !== req.session.locale) {
    res.redirect(`/${path}/${model.languageVersion[identifier]}`)
  } else if (model) {
    const payload = {
      [singlePath]: model
    }
    if (additionalPayload) {
      Object.entries(additionalPayload).map((item, index) => {
        payload[item[0]] = item[1]
      })
    }
    return res.render(`${singlePath}`, payload);

  } else {
    return res.redirect(`/${path}`)
  }
}
module.exports.getAvailableTranslations = async (req, res) => {
  const currentLanguage = await Language.findOne(!!req.session.locale ? {title: req.session.locale} : {title: 'en'});
  return {language: !req.session.locale ? {$in: [currentLanguage._id, null]} : currentLanguage._id}
}
