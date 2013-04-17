/**
 * @name views.leaders
 * @namespace League stat leaders.
 */
define(["db", "globals", "ui", "lib/jquery", "lib/knockout", "lib/knockout.mapping", "lib/underscore", "util/bbgmView", "util/helpers", "util/viewHelpers", "views/components"], function (db, g, ui, $, ko, komapping, _, bbgmView, helpers, viewHelpers, components) {
    "use strict";

    var mapping;

    function get(req) {
        return {
            season: helpers.validateSeason(req.params.season)
        };
    }

    function InitViewModel() {
        this.season = ko.observable();
        this.categories = ko.observable([]);
    }

    mapping = {
        categories: {
            create: function (options) {
                return new function () {
                    komapping.fromJS(options.data, {
                        data: {
                            key: function (data) {
                                return ko.utils.unwrapObservable(data.pid);
                            }
                        }
                    }, this);
                }();
            },
            key: function (data) {
                return ko.utils.unwrapObservable(data.name);
            }
        }
    };

    function updateLeaders(inputs, updateEvents, vm) {
        var deferred, tx, vars;

        if ((inputs.season === g.season && updateEvents.indexOf("gameSim") >= 0) || inputs.season !== vm.season()) {
            deferred = $.Deferred();
            vars = {};

            tx = g.dbl.transaction(["players", "teams"]);

            tx.objectStore("teams").getAll().onsuccess = function (event) {
                var gps, i, teams;

                teams = event.target.result;

                // Calculate the number of games played for each team, which is used later to test if a player qualifies as a league leader
                gps = [];
                for (i = 0; i < teams.length; i++) {
                    gps[i] = _.last(teams[i].seasons).gp;
                }

                tx.objectStore("players").getAll().onsuccess = function (event) {
                    var attributes, categories, i, j, k, leader, pass, players, ratings, stats, userAbbrev, playerValue;

                    userAbbrev = helpers.getAbbrev(g.userTid);

                    // minStats and minValues are the NBA requirements to be a league leader for each stat http://www.nba.com/leader_requirements.html. If any requirement is met, the player can appear in the league leaders
                    categories = [];
                    categories.push({name: "Points", stat: "Pts", title: "Points Per Game", data: [], minStats: ["gp", "pts"], minValue: [70, 1400]});
                    categories.push({name: "Rebounds", stat: "Reb", title: "Rebounds Per Game", data: [], minStats: ["gp", "trb"], minValue: [70, 800]});
                    categories.push({name: "Assists", stat: "Ast", title: "Assists Per Game", data: [], minStats: ["gp", "ast"], minValue: [70, 400]});
                    categories.push({name: "Field Goal Percentage", stat: "FG%", title: "Field Goal Percentage", data: [], minStats: ["fg"], minValue: [300]});
                    categories.push({name: "Three-Pointer Percentage", stat: "3PT%", title: "Three-Pointer Percentage", data: [], minStats: ["tp"], minValue: [55]});
                    categories.push({name: "Free Throw Percentage", stat: "FT%", title: "Free Throw Percentage", data: [], minStats: ["ft"], minValue: [125]});
                    categories.push({name: "Blocks", stat: "Blk", title: "Blocks Per Game", data: [], minStats: ["gp", "blk"], minValue: [70, 100]});
                    categories.push({name: "Steals", stat: "Stl", title: "Steals Per Game", data: [], minStats: ["gp", "stl"], minValue: [70, 125]});
                    categories.push({name: "Minutes", stat: "Min", title: "Minutes Per Game", data: [], minStats: ["gp", "min"], minValue: [70, 2000]});
                    categories.push({name: "Player Efficiency Rating", stat: "PER", title: "Player Efficiency Rating", data: [], minStats: ["min"], minValue: [2000]});

                    attributes = ["pid", "name", "tid", "injury"];
                    ratings = ["skills"];
                    stats = ["pts", "trb", "ast", "fgp", "tpp", "ftp", "blk", "stl", "min", "per", "gp", "fg", "tp", "ft", "abbrev"];  // This needs to be in the same order as categories (at least, initially)
                    players = db.getPlayers(event.target.result, inputs.season, null, attributes, stats, ratings);

                    for (i = 0; i < categories.length; i++) {
                        players.sort(function (a, b) { return b.stats[stats[i]] - a.stats[stats[i]]; });
                        for (j = 0; j < players.length; j++) {
                            // Test if the player meets the minimum statistical requirements for this category
                            pass = false;
                            for (k = 0; k < categories[i].minStats.length; k++) {
                                // Everything except gp is a per-game average, so we need to scale them by games played
                                if (categories[i].minStats[k] === "gp") {
                                    playerValue = players[j].stats[categories[i].minStats[k]];
                                } else {
                                    playerValue = players[j].stats[categories[i].minStats[k]] * players[j].stats.gp;
                                }

                                // Compare against value normalized for team games played
                                if (playerValue >= Math.ceil(categories[i].minValue[k] * gps[players[j].tid] / 82)) {
                                    pass = true;
                                    break;  // If one is true, don't need to check the others
                                }
                            }

                            if (pass) {
                                leader = helpers.deepCopy(players[j]);
                                leader.i = categories[i].data.length + 1;
                                leader.stat = leader.stats[stats[i]];
                                leader.abbrev = leader.stats.abbrev;
                                delete leader.stats;
                                if (userAbbrev === leader.abbrev) {
                                    leader.userTeam = true;
                                } else {
                                    leader.userTeam = false;
                                }
                                categories[i].data.push(leader);
                            }

                            // Stop when we found 10
                            if (categories[i].data.length === 10) {
                                break;
                            }
                        }

                        if (i % 3 === 0 && i > 0) {
                            categories[i].newRow = true;
                        } else {
                            categories[i].newRow = false;
                        }

                        delete categories[i].minStats;
                        delete categories[i].minValue;
                    }

                    vars = {
                        season: inputs.season,
                        categories: categories
                    };

                    deferred.resolve(vars);
                };
            };

            return deferred.promise();
        }
    }

    function uiEvery(updateEvents, vm) {
        var season;

        season = vm.season();

        ui.title("League Leaders - " + season);

        components.dropdown("leaders-dropdown", ["seasons"], [season], updateEvents);
    }

    return bbgmView.init({
        id: "leaders",
        get: get,
        InitViewModel: InitViewModel,
        mapping: mapping,
        runBefore: [updateLeaders],
        uiEvery: uiEvery
    });
});