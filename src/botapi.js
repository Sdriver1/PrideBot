const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { EmbedBuilder, ChannelType } = require("discord.js");
const CommandUsage = require("../mongo/models/usageSchema.js");
const ProfileData = require("../mongo/models/profileSchema.js");
const Voting = require("../mongo/models/votingSchema");
const { botlistauth } = process.env;
require("dotenv").config();

const { getTotalCommits } = require("./config/commandfunctions/commit.js");
const {
  getRegisteredCommandsCount,
} = require("./config/commandfunctions/registercommand.js");
const { updateVotingStats } = require("./config/botfunctions/voting.js");

module.exports = (client) => {
  const app = express();
  const port = 2610;

  app.listen(port, () => {
    console.log(`Bot api is running on port ${port}`);
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors());

  app.get("/", (req, res) => {
    res.status(404).json({
      message: "These are the API requests you can make:",
      endpoints: {
        stats: "/api/stats",
        profiles: "/api/profiles/:userId",
        votes: "/api/votes/:userId",
        commands: "/api/commands/:command_type?/:command_name?",
      },
    });
  });

  app.get("/api/stats", cors(), async (req, res) => {
    const currentGuildCount = client.guilds.cache.size;

    let totalUserCount = 0;
    client.guilds.cache.forEach((guild) => {
      totalUserCount += guild.memberCount;
    });

    try {
      const usages = await CommandUsage.find({}).sort({ count: -1 });
      const totalUsage = usages.reduce((acc, cmd) => acc + cmd.count, 0);

      const commandsCount = (await getRegisteredCommandsCount(client)) + 2;

      const botuptime = client.botStartTime;

      const voting = await Voting.findOne();
      const votingtotal = voting.votingAmount.OverallTotal;
      const topggtoal = voting.votingAmount.TopGGTotal;
      const wumpustotal = voting.votingAmount.WumpusTotal;
      const botlisttotal = voting.votingAmount.BotListTotal;

      res.json({
        totalUserCount,
        currentGuildCount,
        totalUsage,
        commandsCount,
        botuptime,
        vote: {
          votingtotal,
          topggtoal,
          wumpustotal,
          botlisttotal,
        },
      });
    } catch (error) {
      console.error("Failed to get API stats:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  app.get("/api/profiles/:userId", cors(), async (req, res) => {
    try {
      const profile = await ProfileData.findOne({ userId: req.params.userId });

      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      return res.json(profile);
    } catch (error) {
      console.error("Failed to retrieve profile:", error);
      return res.status(500).send("Internal Server Error");
    }
  });

  app.get("/api/votes/:userId", cors(), async (req, res) => {
    try {
      const votes = await Voting.findOne(
        { "votingUsers.userId": req.params.userId },
        { "votingUsers.$": 1 }
      );

      if (!votes || votes.votingUsers.length === 0) {
        return res.status(404).json({ message: "User has not voted yet!" });
      }

      return res.json(votes.votingUsers[0]);
    } catch (error) {
      console.error("Failed to retrieve voting stats:", error);
      return res.status(500).send("Internal Server Error");
    }
  });

  const commandsDirectory = path.join(__dirname, "commands");

  app.get(
    "/api/commands/:command_type?/:command_name?",
    cors(),
    async (req, res) => {
      const { command_type, command_name } = req.params;

      try {
        if (!command_type) {
          const allCommandTypes = fs
            .readdirSync(commandsDirectory)
            .reduce((acc, type) => {
              const commands = fs
                .readdirSync(path.join(commandsDirectory, type))
                .map((file) => file.replace(".js", ""));
              acc[type] = {
                commands,
                count: commands.length,
              };
              return acc;
            }, {});

          return res.json(allCommandTypes);
        }

        const commandTypeDir = path.join(commandsDirectory, command_type);
        if (!command_name) {
          if (!fs.existsSync(commandTypeDir)) {
            return res.status(404).send("Command type not found");
          }

          const commands = fs
            .readdirSync(commandTypeDir)
            .map((file) => file.replace(".js", ""));
          return res.json({
            [command_type]: {
              commands,
            },
          });
        }

        const commandFile = path.join(commandTypeDir, `${command_name}.js`);
        if (!fs.existsSync(commandFile)) {
          return res.status(404).send("Command not found");
        }

        const commandUsage = await CommandUsage.findOne({
          commandName: command_name,
        });

        return res.json({
          command_name: commandUsage ? commandUsage.commandName : command_name,
          command_usage: commandUsage ? commandUsage.count : 0,
        });
      } catch (error) {
        console.error("Failed to retrieve bot commands:", error);
        return res.status(500).send("Internal Server Error");
      }
    }
  );

  app.post("/wumpus-votes", async (req, res) => {
    let wumpususer = req.body.userId;
    let wumpusbot = req.body.botId;
    const voteCooldownHours = 12;
    const voteCooldownSeconds = voteCooldownHours * 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const voteAvailableTimestamp = currentTimestamp + voteCooldownSeconds;

    client.users
      .fetch(wumpususer)
      .then(async (user) => {
        const userAvatarURL = user.displayAvatarURL();

        await updateVotingStats(wumpususer, "Wumpus");

        const voting = await Voting.findOne();
        const userVoting = voting.votingUsers.find(
          (u) => u.userId === wumpususer
        );

        const embed = new EmbedBuilder()
          .setDescription(
            `**Thank you <@${wumpususer}> for voting for <@${wumpusbot}> on [Wumpus.Store](https://wumpus.store/bot/${wumpusbot}/vote) <:_:1198663251580440697>** \nYou can vote again <t:${voteAvailableTimestamp}:R>.\n\n<@${wumpususer}> **Wumpus.Store Votes: ${userVoting.votingWumpus}** \n**Total Wumpus.Store Votes: ${voting.votingAmount.WumpusTotal}**`
          )
          .setColor("#FF00EA")
          .setThumbnail(userAvatarURL)
          .setTimestamp();

        try {
          const channel = await client.channels.fetch("1224815141921624186");
          if (!channel || channel.type !== ChannelType.GuildText) {
            return res
              .status(400)
              .send("Channel not found or is not a text channel");
          }

          await channel.send({ embeds: [embed] });
          res.status(200).send("Success!");
        } catch (error) {
          console.error("Error sending message to Discord:", error);
          res.status(500).send("Internal Server Error");
        }
      })
      .catch((error) => {
        console.error("Error fetching user from Discord:", error);
        res.status(500).send("Internal Server Error");
      });
  });

  app.post("/topgg-votes", async (req, res) => {
    let topgguserid = req.body.user;
    let topggbotid = req.body.bot;
    const voteCooldownHours = 12;
    const voteCooldownSeconds = voteCooldownHours * 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const voteAvailableTimestamp = currentTimestamp + voteCooldownSeconds;

    client.users
      .fetch(topgguserid)
      .then(async (user) => {
        const userAvatarURL = user.displayAvatarURL();

        await updateVotingStats(topgguserid, "TopGG");

        const voting = await Voting.findOne();
        const userVoting = voting.votingUsers.find(
          (u) => u.userId === topgguserid
        );

        const embed = new EmbedBuilder()
          .setDescription(
            `**Thank you <@${topgguserid}> for voting for <@${topggbotid}> on [Top.gg](https://top.gg/bot/${topggbotid}/vote) <:_:1195866944482590731>** \nYou can vote again <t:${voteAvailableTimestamp}:R> \n\n**<@${topgguserid}> Top.gg Votes: ${userVoting.votingTopGG}** \n**Total Top.gg Votes: ${voting.votingAmount.TopGGTotal}**`
          )
          .setColor("#FF00EA")
          .setThumbnail(userAvatarURL)
          .setTimestamp();

        try {
          const channel = await client.channels.fetch("1224815141921624186");
          if (!channel || channel.type !== ChannelType.GuildText) {
            return res
              .status(400)
              .send("Channel not found or is not a text channel");
          }

          await channel.send({ embeds: [embed] });
          res.status(200).send("Success!");
        } catch (error) {
          console.error("Error sending message to Discord:", error);
          res.status(500).send("Internal Server Error");
        }
      })
      .catch((error) => {
        console.error("Error fetching user from Discord:", error);
        res.status(500).send("Internal Server Error");
      });
  });

  app.post("/botlist-votes", async (req, res) => {
    if (req.header("Authorization") != botlistauth) {
      return res.status("401").end();
    }

    let botlistuser = req.body.user;
    let botlistbot = req.body.bot;
    const voteCooldownHours = 12;
    const voteCooldownSeconds = voteCooldownHours * 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const voteAvailableTimestamp = currentTimestamp + voteCooldownSeconds;

    client.users
      .fetch(botlistuser)
      .then(async (user) => {
        const userAvatarURL = user.displayAvatarURL();

        await updateVotingStats(botlistuser, "BotList");

        const voting = await Voting.findOne();
        const userVoting = voting.votingUsers.find(
          (u) => u.userId === botlistuser
        );

        const embed = new EmbedBuilder()
          .setDescription(
            `**Thank you <@${botlistuser}> for voting for <@${botlistbot}> on [Botlist.me](https://botlist.me/bots/${botlistbot}/vote) <:_:1227425669642719282>** \nYou can vote again <t:${voteAvailableTimestamp}:R>. \n\n**<@${botlistuser}> Botlist Votes: ${userVoting.votingBotList}** \n**Total Botlist Votes: ${voting.votingAmount.BotListTotal}**`
          )
          .setColor("#FF00EA")
          .setThumbnail(userAvatarURL)
          .setTimestamp();

        try {
          const channel = await client.channels.fetch("1224815141921624186");
          if (!channel || channel.type !== ChannelType.GuildText) {
            return res
              .status(400)
              .send("Channel not found or is not a text channel");
          }

          await channel.send({ embeds: [embed] });
          res.status(200).send("Success!");
        } catch (error) {
          console.error("Error sending message to Discord:", error);
          res.status(500).send("Internal Server Error");
        }
      })
      .catch((error) => {
        console.error("Error fetching user from Discord:", error);
        res.status(500).send("Internal Server Error");
      });
  });

  app.post(
    "/github",
    express.json({ type: "application/json" }),
    async (request, response) => {
      const githubEvent = request.headers["x-github-event"];
      const data = request.body;
      let embed = new EmbedBuilder();

      async function getTotalCommitsFromRepo(repoName) {
        return await getTotalCommits(
          "Sdriver1",
          repoName,
          process.env.githubToken
        );
      }

      let totalCommits;
      if (data.repository.name === "Pridebot") {
        totalCommits = await getTotalCommitsFromRepo("Pridebot");
      } else if (data.repository.name === "Pridebot-Website") {
        totalCommits = await getTotalCommitsFromRepo("Pridebot-Website");
      } else {
        totalCommits = 0;
      }

      let commitPrefix = data.repository.name === "Pridebot" ? "2" : "";
      let commitTens = totalCommits.toString().slice(-2, -1) || "0";
      let commitOnes = totalCommits.toString().slice(-1);

      if (githubEvent === "push") {
        const commitCount = data.commits.length;
        const commitMessages = data.commits
          .map(
            (commit) =>
              `[\`${commit.id.slice(0, 7)}\`](${commit.url}) - **${
                commit.message
              }**`
          )
          .join("\n");
        const title = `${commitCount} New ${data.repository.name} ${
          commitCount > 1 ? "Commits" : "Commit"
        } (# ${commitPrefix}${commitTens}${commitOnes})`;
        const fieldname = `${commitCount > 1 ? "Commits" : "Commit"}`;

        embed
          .setColor("#FF00EA")
          .setAuthor({
            name: `${data.pusher.name}`,
            iconURL: `https://cdn.discordapp.com/emojis/1226912165982638174.png`,
            url: `https://github.com/${data.pusher.name}`,
          })
          .setTitle(title)
          .setTimestamp()
          .addFields({ name: fieldname, value: commitMessages });
      } else if (githubEvent === "star" && data.action === "created") {
        embed
          .setColor("#FF00EA")
          .setDescription(
            `## :star: New Star \n**Thank you [${data.sender.login}](https://github.com/${data.sender.name}) for starring [${data.repository.name}](https://github.com/${data.repository.full_name})**`
          )
          .setTimestamp();
      } else if (githubEvent === "star" && data.action === "deleted") {
        console.log(`${data.sender.login} removed their star ;-;`);
      } else {
        console.log(`Unhandled event: ${githubEvent}`);
        return;
      }

      try {
        const channel = await client.channels.fetch("1101742377372237906");
        if (!channel) {
          console.log("Could not find channel");
          return;
        }

        await channel.send({ embeds: [embed] });
      } catch (error) {
        console.error("Error sending message to Discord:");
      }
    }
  );
};
