Promise = require("bluebird");
const Rx = require('rx');
const Splitter = artifacts.require("./Splitter.sol");
const expectedException = require("../utils/expectedException.js");
const sequentialPromise = require("../utils/sequentialPromise.js");
const nextSplitterState = require("../app/nextSplitterState.js");
web3.eth.makeSureHasAtLeast = require("../utils/makeSureHasAtLeast.js");
web3.eth.makeSureAreUnlocked = require("../utils/makeSureAreUnlocked.js");
web3.eth.getTransactionReceiptMined = require("../utils/getTransactionReceiptMined.js");

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

contract('Splitter', function(accounts) {

    let splitter, alice, bob, carol;

    before("should prepare accounts", function() {
        assert.isAtLeast(accounts.length, 3, "should have at least 3 accounts");
        [ alice, bob, carol ] = accounts;
        return web3.eth.makeSureAreUnlocked([ alice, bob, carol ])
            .then(() => web3.eth.makeSureHasAtLeast(alice, [ bob, carol ], web3.toWei(2)))
            .then(txHashes => web3.eth.getTransactionReceiptMined(txHashes));
    });

    beforeEach("deploy new Splitter", function() {
        return Splitter.new({ from: alice })
            .then(instance => splitter = instance);
    });

    it("should reject direct transaction with value", function() {
        return expectedException(
            () => splitter.sendTransaction({ from: alice, value: 1, gas: 3000000 }),
            3000000);
    });

    it("should reject direct transaction without value", function() {
        return expectedException(
            () => splitter.sendTransaction({ from: alice, gas: 3000000 }),
            3000000);
    });

    it("should deploy an instance in Migration", function() {
        return Splitter.deployed()
            .then(instance => web3.eth.getCodePromise(instance.address))
            .then(code => assert.isAtLeast(code.length, 30));
    });

    describe("split", function() {

        it("should reject without Ether", function() {
            return expectedException(
                () => splitter.split(bob, carol, { from: alice, gas: 3000000 }),
                3000000);
        });

        it("should reject with 1 Wei", function() {
            return expectedException(
                () => splitter.split(bob, carol, { from: alice, value: 1, gas: 3000000 }),
                3000000);
        });

        it("should reject without Bob", function() {
            return expectedException(
                () => splitter.split(0, carol, { from: alice, value: 1000, gas: 3000000 }),
                3000000);
        });

        it("should reject without Carol", function() {
            return expectedException(
                () => splitter.split(bob, 0, { from: alice, value: 1000, gas: 3000000 }),
                3000000);
        });

        const valueSetSingle = [
            { sent:    "2", bob:   "1", carol:   "1", total:    "2" },
            { sent:    "3", bob:   "1", carol:   "2", total:    "3" },
            { sent: "1000", bob: "500", carol: "500", total: "1000" },
            { sent: "1001", bob: "500", carol: "501", total: "1001" },
        ];

        valueSetSingle.forEach(values => {

            describe("single split situation: " + values.sent + " -> " + values.bob + " + " + values.carol, function() {

                it("should emit a single event when split", function() {
                    return splitter.split(bob, carol, { from: alice, value: values.sent })
                        .then(txObject => {
                            assert.strictEqual(txObject.logs.length, 1);
                            assert.strictEqual(txObject.logs[0].event, "LogSplit");
                            assert.strictEqual(txObject.logs[0].args.sender, alice);
                            assert.strictEqual(txObject.logs[0].args.bob, bob);
                            assert.strictEqual(txObject.logs[0].args.carol, carol);
                            assert.strictEqual(txObject.logs[0].args.amount.toString(10), values.sent);
                        });
                });

                it("should have indexed topics in event when split", function() {
                    return splitter.split(bob, carol, { from: alice, value: values.sent })
                        .then(txObject => {
                            assert.strictEqual(txObject.receipt.logs.length, 1);
                            assert.strictEqual(txObject.receipt.logs[0].topics.length, 4);
                            assert.strictEqual(
                                txObject.receipt.logs[0].topics[0],
                                web3.sha3("LogSplit(address,address,address,uint256)"));
                            assert.strictEqual(
                                txObject.receipt.logs[0].topics[1],
                                alice.replace("0x", "0x000000000000000000000000"));
                            assert.strictEqual(
                                txObject.receipt.logs[0].topics[2],
                                bob.replace("0x", "0x000000000000000000000000"));
                            assert.strictEqual(
                                txObject.receipt.logs[0].topics[3],
                                carol.replace("0x", "0x000000000000000000000000"));
                        });
                });

                it("should keep Weis in contract when split", function() {
                    return splitter.split(bob, carol, { from: alice, value: values.sent })
                        .then(txObject => web3.eth.getBalancePromise(splitter.address))
                        .then(balance => assert.strictEqual(balance.toString(10), values.total));
                });

                it("should record owed un/equally when split", function() {
                    return splitter.split(bob, carol, { from: alice, value: values.sent })
                        .then(txObject => splitter.balances(bob))
                        .then(owedBob => assert.strictEqual(owedBob.toString(10), values.bob))
                        .then(() => splitter.balances(carol))
                        .then(owedCarol => assert.strictEqual(owedCarol.toString(10), values.carol));
                });

            });

        });

        const valueSetDouble = [
            { sent:    "2", bob: "1001", carol: "1001", total: "2002" },
            { sent:    "3", bob: "1001", carol: "1002", total: "2003" },
            { sent: "1000", bob: "1500", carol: "1500", total: "3000" },
            { sent: "1001", bob: "1500", carol: "1501", total: "3001" },
        ];

        valueSetDouble.forEach(values => {

            describe("double split situation after 2000 split: " + values.sent + " -> " + values.bob + " + " + values.carol, function() {

                beforeEach("split 2000 first", function() {
                    return splitter.split(bob, carol, { from: alice, value: 2000 });
                });

                it("should emit a single event when split again", function() {
                    return splitter.split(bob, carol, { from: alice, value: values.sent })
                        .then(txObject => {
                            assert.strictEqual(txObject.logs.length, 1);
                            assert.strictEqual(txObject.logs[0].event, "LogSplit");
                            assert.strictEqual(txObject.logs[0].args.sender, alice);
                            assert.strictEqual(txObject.logs[0].args.bob, bob);
                            assert.strictEqual(txObject.logs[0].args.carol, carol);
                            assert.strictEqual(txObject.logs[0].args.amount.toString(10), values.sent);
                        });
                });

                it("should have indexed topics in event when split again", function() {
                    return splitter.split(bob, carol, { from: alice, value: values.sent })
                        .then(txObject => {
                            assert.strictEqual(txObject.receipt.logs.length, 1);
                            assert.strictEqual(txObject.receipt.logs[0].topics.length, 4);
                            assert.strictEqual(
                                txObject.receipt.logs[0].topics[0],
                                web3.sha3("LogSplit(address,address,address,uint256)"));
                            assert.strictEqual(
                                txObject.receipt.logs[0].topics[1],
                                alice.replace("0x", "0x000000000000000000000000"));
                            assert.strictEqual(
                                txObject.receipt.logs[0].topics[2],
                                bob.replace("0x", "0x000000000000000000000000"));
                            assert.strictEqual(
                                txObject.receipt.logs[0].topics[3],
                                carol.replace("0x", "0x000000000000000000000000"));
                        });
                });

                it("should keep Weis in contract when split", function() {
                    return splitter.split(bob, carol, { from: alice, value: values.sent })
                        .then(txObject => web3.eth.getBalancePromise(splitter.address))
                        .then(balance => assert.strictEqual(balance.toString(10), values.total));
                });

                it("should record owed un/equally when split", function() {
                    return splitter.split(bob, carol, { from: alice, value: values.sent })
                        .then(txObject => splitter.balances(bob))
                        .then(owedBob => assert.strictEqual(owedBob.toString(10), values.bob))
                        .then(() => splitter.balances(carol))
                        .then(owedCarol => assert.strictEqual(owedCarol.toString(10), values.carol));
                });

            });

        });

    });

    describe("withdraw", function() {

        beforeEach("split 2001 first", function() {
            return splitter.split(bob, carol, { from: alice, value: 2001 });
        });

        it("should reject withdraw by alice", function() {
            return expectedException(
                () => splitter.withdraw({ from: alice, gas: 3000000 }),
                3000000);
        });

        it("should reject withdraw if value passed", function() {
            return splitter.withdraw({ from: bob, value: 1 })
                .then(
                    txObject => assert.fail("Should not have been accepted"),
                    e => assert.isAtLeast(e.message.indexOf("Cannot send value to non-payable function"), 0)
                );
        });

        it("should emit a single event when bob withdraws", function() {
            return splitter.withdraw({ from: bob })
                .then(txObject => {
                    assert.strictEqual(txObject.logs.length, 1);
                    assert.strictEqual(txObject.logs[0].event, "LogWithdrawn");
                    assert.strictEqual(txObject.logs[0].args.who, bob);
                    assert.strictEqual(txObject.logs[0].args.amount.toString(10), "1000");
                });
        });

        it("should have indexed topics in event when bob withdraws", function() {
            return splitter.withdraw({ from: bob })
                .then(txObject => {
                    assert.strictEqual(txObject.receipt.logs.length, 1);
                    assert.strictEqual(txObject.receipt.logs[0].topics.length, 2);
                    assert.strictEqual(
                        txObject.receipt.logs[0].topics[0],
                        web3.sha3("LogWithdrawn(address,uint256)"));
                    assert.strictEqual(
                        txObject.receipt.logs[0].topics[1],
                        bob.replace("0x", "0x000000000000000000000000"));
                });
        });

        it("should reduce splitter balance by withdrawn amount", function() {
            return splitter.withdraw({ from: bob })
                .then(txObject => web3.eth.getBalancePromise(splitter.address))
                .then(balance => assert.strictEqual(balance.toString(10), "1001"));
        });

        it("should increase bob balance with amount", function() {
            let bobBalanceBefore, txFee;
            return web3.eth.getBalancePromise(bob)
                .then(balance => bobBalanceBefore = balance)
                .then(() => splitter.withdraw({ from: bob }))
                .then(txObject => web3.eth.getTransactionPromise(txObject.tx)
                        .then(tx => txFee = tx.gasPrice.times(txObject.receipt.gasUsed)))
                .then(() => web3.eth.getBalancePromise(bob))
                .then(balance => assert.strictEqual(
                    bobBalanceBefore.plus(1000).minus(txFee).toString(10),
                    balance.toString(10)));
        });

        it("should reject bob withdrawing twice", function() {
            return splitter.withdraw({ from: bob })
                .then(txObject => expectedException(
                    () => splitter.withdraw({ from: bob, gas: 3000000 }),
                    3000000));
        });

    });

    describe("state reconstruction", function() {

        let fromBlock;

        beforeEach("prepare splitter", function() {
            splitter.allEventsRx = require("../utils/allEventsRx.js");
        });

        beforeEach("fetch fromBlock", function() {
            return web3.eth.getTransactionReceiptPromise(splitter.transactionHash)
                .then(receipt => fromBlock = receipt.blockNumber);
        });

        const eventToState = function(initialState) {
            let state = initialState;
            return function(oneEvent) {
                state = nextSplitterState(state, oneEvent);
                return state;
            }
        };

        it("should reconstruct state from events", function() {
            // Does not work on some TestRPC versions.
            const actionSequence = [
                () => splitter.split.sendTransaction(bob, carol, { from: alice, value: 10 }),
                () => splitter.split(bob, carol, { from: alice, value: 15 }),
                () => splitter.withdraw({ from: carol }),
                () => splitter.withdraw.sendTransaction({ from: bob }),
            ];
            const expectedStates = [ {}, {}, {}, {} ];
            expectedStates[0][bob] = "5";
            expectedStates[0][carol] = "5";
            expectedStates[1][bob] = "12";
            expectedStates[1][carol] = "13";
            expectedStates[2][bob] = "12";
            expectedStates[2][carol] = "0";
            expectedStates[3][bob] = "0";
            expectedStates[3][carol] = "0";
            return Rx.Observable.fromPromise(sequentialPromise(actionSequence))
                .flatMap(txHashes => splitter.allEventsRx({ fromBlock: fromBlock, toBlock: "latest" }))
                .map(eventToState({}))
                .take(actionSequence.length)
                .toArray()
                .do(actual => assert.deepEqual(actual, expectedStates))
                .toPromise();
        });

    });

});
