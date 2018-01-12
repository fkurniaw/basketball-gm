// @flow

// Functions only used for debugging the game, particularly balance issues. This should not be included or loaded in the compiled version.

import backboard from "backboard";
import range from "lodash/range";
import { PLAYER, g, helpers } from "../../common";
import { player } from "../core";
import { idb } from "../db";
import type { RatingKey } from "../../common/types";

async function regressRatingsPer() {
    // http://rosettacode.org/wiki/Multiple_regression#JavaScript
    function Matrix(ary) {
        this.mtx = ary;
        this.height = ary.length;
        this.width = ary[0].length;
    }

    /* Flow doesn't like this
    Matrix.prototype.toString = function () {
        const s = [];
        for (let i = 0; i < this.mtx.length; i++) {
            s.push(this.mtx[i].join(","));
        }
        return s.join("\n");
    };*/

    // returns a new matrix
    Matrix.prototype.transpose = function() {
        const transposed = [];
        for (let i = 0; i < this.width; i++) {
            transposed[i] = [];
            for (let j = 0; j < this.height; j++) {
                transposed[i][j] = this.mtx[j][i];
            }
        }
        return new Matrix(transposed);
    };

    // returns a new matrix
    Matrix.prototype.mult = function(other) {
        if (this.width !== other.height) {
            throw new Error("incompatible sizes");
        }

        const result = [];
        for (let i = 0; i < this.height; i++) {
            result[i] = [];
            for (let j = 0; j < other.width; j++) {
                let sum = 0;
                for (let k = 0; k < this.width; k++) {
                    sum += this.mtx[i][k] * other.mtx[k][j];
                }
                result[i][j] = sum;
            }
        }
        return new Matrix(result);
    };

    // modifies the matrix in-place
    Matrix.prototype.toReducedRowEchelonForm = function() {
        let lead = 0;
        for (let r = 0; r < this.height; r++) {
            if (this.width <= lead) {
                return;
            }

            {
                let i = r;
                while (this.mtx[i][lead] === 0) {
                    i++;
                    if (this.height === i) {
                        i = r;
                        lead++;
                        if (this.width === lead) {
                            return;
                        }
                    }
                }

                const tmp = this.mtx[i];
                this.mtx[i] = this.mtx[r];
                this.mtx[r] = tmp;
            }

            let val = this.mtx[r][lead];
            for (let j = 0; j < this.width; j++) {
                this.mtx[r][j] /= val;
            }

            for (let i = 0; i < this.height; i++) {
                if (i !== r) {
                    val = this.mtx[i][lead];
                    for (let j = 0; j < this.width; j++) {
                        this.mtx[i][j] -= val * this.mtx[r][j];
                    }
                }
            }
            lead++;
        }
    };

    function IdentityMatrix(n) {
        this.height = n;
        this.width = n;
        this.mtx = [];
        for (let i = 0; i < n; i++) {
            this.mtx[i] = [];
            for (let j = 0; j < n; j++) {
                this.mtx[i][j] = i === j ? 1 : 0;
            }
        }
    }
    IdentityMatrix.prototype = Matrix.prototype;

    // modifies the matrix "in place"
    Matrix.prototype.inverse = function() {
        if (this.height !== this.width) {
            throw new Error("can't invert a non-square matrix");
        }

        const I = new IdentityMatrix(this.height);
        for (let i = 0; i < this.height; i++) {
            this.mtx[i] = this.mtx[i].concat(I.mtx[i]);
        }
        this.width *= 2;

        this.toReducedRowEchelonForm();

        for (let i = 0; i < this.height; i++) {
            this.mtx[i].splice(0, this.height);
        }
        this.width /= 2;

        return this;
    };

    function ColumnVector(ary) {
        return new Matrix(ary.map(v => [v]));
    }
    ColumnVector.prototype = Matrix.prototype;

    Matrix.prototype.regressionCoefficients = function(x) {
        const xT = x.transpose();

        return xT
            .mult(x)
            .inverse()
            .mult(xT)
            .mult(this);
    };

    let players = await idb.getCopies.players({ activeAndRetired: true });
    players = await idb.getCopies.playersPlus(players, {
        ratings: [
            "season",
            "hgt",
            "stre",
            "spd",
            "jmp",
            "endu",
            "ins",
            "dnk",
            "ft",
            "fg",
            "tp",
            "oiq",
            "diq",
            "drb",
            "pss",
            "reb",
        ],
        stats: ["season", "per", "min"],
        statType: "totals",
    });

    const pers = [];
    const ratings = [];

    for (const p of players) {
        // Loop through seasons
        for (const pr of p.ratings) {
            // Find stats entry to match ratings
            for (const ps of p.stats) {
                if (pr.season === ps.season && !ps.playoffs) {
                    // Ignore anything under 500 minutes
                    if (ps.min > 500) {
                        pers.push(ps.per);
                        ratings.push([
                            pr.hgt,
                            pr.stre,
                            pr.spd,
                            pr.jmp,
                            pr.endu,
                            pr.ins,
                            pr.dnk,
                            pr.ft,
                            pr.fg,
                            pr.tp,
                            pr.oiq,
                            pr.diq,
                            pr.drb,
                            pr.pss,
                            pr.reb,
                        ]);
                    }
                }
            }
        }
    }

    console.log(ratings);
    const x = new Matrix(ratings);
    console.log(pers);
    const y = new ColumnVector(pers);

    // $FlowFixMe
    const c = y.regressionCoefficients(x);

    const ratingLabels = [
        "hgt",
        "stre",
        "spd",
        "jmp",
        "endu",
        "ins",
        "dnk",
        "ft",
        "fg",
        "tp",
        "oiq",
        "diq",
        "drb",
        "pss",
        "reb",
    ];
    for (let i = 0; i < ratingLabels.length; i++) {
        console.log(`${ratingLabels[i]}: ${c.mtx[i][0] * 100}`);
    }
}

// Returns the average contract for the active players in the league
// Useful to run this while playing with the contract formula in core.player.genContract
async function leagueAverageContract() {
    // All non-retired players
    const players = await idb.league.players
        .index("tid")
        .getAll(backboard.lowerBound(PLAYER.FREE_AGENT));

    let total = 0;

    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const contract = player.genContract(p);
        total += contract.amount;
    }

    console.log(total / players.length);
}

function averageCareerArc(ratingToSave: RatingKey) {
    const numPlayers = 1000; // Number of players per profile
    const numSeasons = 20;

    const averageOvr = [];
    const averagePot = [];
    const averageRat = [];
    for (let i = 0; i < numSeasons; i++) {
        averageOvr[i] = 0;
        averagePot[i] = 0;
        averageRat[i] = 0;
    }

    for (let i = 0; i < numPlayers; i++) {
        const p = player.generate(0, 19, g.season, true, 15);
        for (let k = 0; k < numSeasons; k++) {
            averageOvr[k] += p.ratings[0].ovr;
            averagePot[k] += p.ratings[0].pot;
            if (ratingToSave) {
                averageRat[k] += p.ratings[0][ratingToSave];
            }
            player.develop(p, 1, true);
        }
    }

    for (let i = 0; i < numSeasons; i++) {
        averageOvr[i] /= numPlayers;
        averagePot[i] /= numPlayers;
        if (ratingToSave) {
            averageRat[i] /= numPlayers;
        }
    }

    console.log("ovr:");
    console.log(averageOvr);
    console.log("pot:");
    console.log(averagePot);
    if (ratingToSave) {
        console.log(`${ratingToSave}:`);
        console.log(averageRat);
    }
}

const maxRatingDists = (numPlayers: number = 100) => {
    // Each player gets one entry per array: their career max in a rating
    const ratings = {
        ovr: [],
        stre: [],
        spd: [],
        jmp: [],
        endu: [],
        ins: [],
        dnk: [],
        ft: [],
        fg: [],
        tp: [],
        oiq: [],
        diq: [],
        drb: [],
        pss: [],
        reb: [],
    };
    const ages = helpers.deepCopy(ratings);

    for (let i = 0; i < numPlayers; i++) {
        // Log every 5%
        if (i % Math.round(numPlayers / 20) === 0) {
            console.log(`${Math.round(100 * i / numPlayers)}%`);
        }

        const p = player.generate(PLAYER.FREE_AGENT, 19, g.season, false, 15.5);

        const maxRatings = Object.assign({}, p.ratings[0]);
        const maxAges = Object.assign({}, ages);
        for (const key of Object.keys(maxAges)) {
            maxAges[key] = 19;
        }

        for (let j = 0; j < 20; j++) {
            player.develop(p, 1, false, 15.5, true);
            p.born.year -= 1; // Aging after develop

            for (const key of Object.keys(ratings)) {
                if (p.ratings[0][key] > maxRatings[key]) {
                    maxRatings[key] = p.ratings[0][key];
                    maxAges[key] = g.season - p.born.year;
                }
            }
        }

        for (const key of Object.keys(ratings)) {
            ratings[key].push(maxRatings[key]);
            ages[key].push(maxAges[key]);
        }
    }

    const q1 = Math.floor(0.25 * numPlayers);
    const q2 = Math.floor(0.5 * numPlayers);
    const q3 = Math.floor(0.75 * numPlayers);

    console.log("Ranges are min/q1/median/q3/max");

    for (const key of Object.keys(ratings)) {
        // $FlowFixMe
        ratings[key].sort((a, b) => a - b);
        // $FlowFixMe
        ages[key].sort((a, b) => a - b);

        const ranges = [
            ratings[key][0],
            ratings[key][q1],
            ratings[key][q2],
            ratings[key][q3],
            ratings[key][ratings[key].length - 1],
        ];
        const ageRanges = [
            ages[key][0],
            ages[key][q1],
            ages[key][q2],
            ages[key][q3],
            ages[key][ratings[key].length - 1],
        ];
        const num100s = ratings[key].filter(x => x === 100).length;

        console.log(`${key}:`);
        console.log(`Max ratings: ${JSON.stringify(ranges)}`);
        console.log(`Ages of max ratings: ${JSON.stringify(ageRanges)}`);
        console.log(`Number of 100s: ${num100s}`);
        console.log("");
    }
};

const avgRatingDists = (numPlayers: number = 100) => {
    const NUM_SEASONS = 20;

    const ratings = range(NUM_SEASONS).map(() => {
        return {
            ovr: [],
            stre: [],
            spd: [],
            jmp: [],
            endu: [],
            ins: [],
            dnk: [],
            ft: [],
            fg: [],
            tp: [],
            oiq: [],
            diq: [],
            drb: [],
            pss: [],
            reb: [],
        };
    })

    for (let i = 0; i < numPlayers; i++) {
        // Log every 5%
        if (i % Math.round(numPlayers / 20) === 0) {
            console.log(`${Math.round(100 * i / numPlayers)}%`);
        }

        const p = player.generate(PLAYER.FREE_AGENT, 19, g.season, false, 15.5);

        for (let j = 0; j < NUM_SEASONS; j++) {
            player.develop(p, 1, false, 15.5, true);
            p.born.year -= 1; // Aging after develop


            for (const key of Object.keys(ratings[j])) {
                ratings[j][key].push(p.ratings[0][key]);
            }
        }
    }

    const q1 = Math.floor(0.25 * numPlayers);
    const q2 = Math.floor(0.5 * numPlayers);
    const q3 = Math.floor(0.75 * numPlayers);

    console.log("Career arc for the q1/median/q3 player");

    for (const key of Object.keys(ratings[0])) {
        const ratingsForKey = ratings.map(r => {
            // $FlowFixMe
            return r[key].sort((a, b) => a - b);
        });

        const q1s = ratingsForKey.map(row => row[q1]);
        const q2s = ratingsForKey.map(row => row[q2]);
        const q3s = ratingsForKey.map(row => row[q3]);

        console.log(`${key}:`);
        console.log(`q1: ${JSON.stringify(q1s)}`);
        console.log(`q2: ${JSON.stringify(q2s)}`);
        console.log(`q3: ${JSON.stringify(q3s)}`);
        console.log("");
    }
};

export default {
    regressRatingsPer,
    leagueAverageContract,
    averageCareerArc,
    maxRatingDists,
    avgRatingDists,
};
