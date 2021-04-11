require('dotenv').config({path: __dirname + '/../.env'});
const Story = require("../models/story");
const {getAvailableTranslations, renderLanguageVersion} = require("./AbstractController");

module.exports.getStories = async function (req, res) {
  const query = await getAvailableTranslations(req, res)
  const stories = await Story
    .find(query)
    .sort("order")
    .exec();

  res.render("stories", {
    stories
  });
}
module.exports.getSingleStory = async (req, res) => {
  const story = await Story.findOne({slug: req.params.slug})
    .populate('language')
    .populate('languageVersion')
    .exec();
  renderLanguageVersion(req, res, story, 'story', 'stories', undefined, { title: story.title, metadescription: `Stories - ${story.excerpt}` })
}
