import React, {Component} from "react"
import './App.css'
import {getProvider} from "./getProvider"
import {getEthereum} from "./getEthereum"
import {getProposalState} from "./getProposalState"
import map from "./artifacts/deployments/map.json"
import { ethers } from 'ethers'

class App extends Component {

    state = {
        web3: null,
        accounts: null,
        chainid: null,
        box: null,
        boxValue: [],
        boxInput: "",
        investInput: 0,
        descriptionInput: "",
        governor: null,
        proposals: [],
        waiting: false
    }

    componentDidMount = async () => {

        // Get network provider and web3 instance.
        const provider = await getProvider()

        let accounts
        // Try and enable accounts (connect metamask)
        try {
            const ethereum = await getEthereum()
            accounts = await ethereum.request({ method: 'eth_requestAccounts' })
            const _this = this
            ethereum.on('accountsChanged', function (accounts) {
                _this.setState({accounts})
                _this.loadProposals()
            })
        } catch (e) {
            console.log(`Could not enable accounts. Interaction with contracts not available.
            Use a modern browser with a Web3 plugin to fix this issue.`)
            console.log(e)
        }

        // Get the current chain id
        const { chainId } = await provider.getNetwork()
        
        this.setState({
            provider,
            accounts,
            chainId
        }, await this.loadInitialContracts)
    }

    componentDidUpdate = async (prevProps, prevState) => {
        const { waiting } = this.state
        if (!waiting) {
            console.log("will reload")
            await this.waitFor(1).then(this.loadProposals)
        }
    }

    waitFor = async (blocks) => {
        const { provider } = this.state
        this.setState({ waiting: true })
        const currBlockNumber = await provider.getBlockNumber()
        return new Promise((resolve, reject) => {
            provider.on("block", (blockNumber) => {
                if (blockNumber === currBlockNumber + blocks) {
                    resolve();
                }
            })
        })
    };

    loadInitialContracts = async () => {
        const { chainId } = this.state
        // <=42 to exclude Kovan, <42 to include kovan, 4 for rinkeby
        if (chainId < 4) {
            // Wrong Network!
            return
        }
        
        var _chainID = 0;
        if (chainId === 4){
            _chainID = 4;
        }
        if (chainId === 1337){
            _chainID = "dev"
        }
        const box = await this.loadContract(_chainID,"Box")

        if (!box) {
            return
        }

        const boxValue = await box.retrieve()

        const governor = await this.loadContract(_chainID,"GovernorContract")

        if (!governor) {
            return
        }

        const governanceToken = await this.loadContract(_chainID,"GovernanceToken")

        if (!governanceToken) {
            return
        }

        this.setState({
            box,
            governor,
            governanceToken,
            boxValue
        })

        this.loadProposals()
    }

    loadProposals = async () => {
        const { governor, box, accounts, provider } = this.state
        const boxValue = await box.retrieve()
        const proposalCreated = await governor.filters.ProposalCreated();
        const logs = await governor.queryFilter(proposalCreated, 0, "latest");
        const events = logs.map((log) => governor.interface.parseLog(log));
        const blockNumber = await provider.getBlockNumber()
        var inDao
        var blockOffset = 0
        while (true) {
            try {
                const accountVotes = await governor.getVotes(accounts[0], blockNumber - blockOffset)
                inDao = accountVotes > 0
                break
            } catch (error) {}
            blockOffset += 1
        }
        const proposals = await Promise.all(events.map(async (event) => {
            const { againstVotes, forVotes, abstainVotes } = await governor.proposalVotes(event.args[0])
            return {
                id: event.args[0],
                calldata: event.args[5],
                description: event.args[8],
                againstVotes, 
                forVotes, 
                abstainVotes,
                deadline: (await governor.proposalDeadline(event.args[0])).toNumber() - blockNumber,
                state: getProposalState(await governor.state(event.args[0])),
                eta: await governor.proposalEta(event.args[0])
            }
        }))
        this.setState({proposals, boxValue, inDao, waiting: false })
    }

    loadContract = async (chain, contractName) => {
        // Load a deployed contract instance into a web3 contract object
        const { provider } = this.state

        // Get the address of the most recent deployment from the deployment map
        let address
        try {
            address = map[chain][contractName][0]
        } catch (e) {
            console.log(`Couldn't find any deployed contract "${contractName}" on the chain "${chain}".`)
            return undefined
        }

        // Load the artifact with the specified address
        let contractArtifact
        try {
            contractArtifact = await import(`./artifacts/deployments/${chain}/${address}.json`)
        } catch (e) {
            console.log(`Failed to load contract artifact "./artifacts/deployments/${chain}/${address}.json"`)
            return undefined
        }

        return new ethers.Contract(address, contractArtifact.abi, provider.getSigner())
    }

    propose = async (e) => {
        const { governor, box, boxInput, descriptionInput } = this.state
        e.preventDefault()
        const encodedFunctionCall = box.interface.encodeFunctionData("store", [[boxInput]])
        try {
            await governor.propose(
                [box.address],
                [0],
                [encodedFunctionCall],
                descriptionInput
            )
        } catch (e) {
            console.log(e)
        }
    }

    vote = async (id) => {
        const { governor } = this.state
        try {
            // 0: against, 1: for, 2: abstain
            await governor.castVoteWithReason(id, 1, "just testing la")
        } catch (e) {
            console.log(e)
        }
    }

    queue = async (proposal) => {
        const { governor, box  } = this.state
        const descriptionHash = ethers.utils.id(proposal.description)
        try {
            await governor.queue(
                [box.address], 
                [0], 
                proposal.calldata,
                descriptionHash
            )
        } catch (e) {
            console.log(e)
        }
    }

    execute = async (proposal) => {
        const { governor, box  } = this.state
        const descriptionHash = ethers.utils.id(proposal.description)
        try {
            await governor.execute(
                [box.address], 
                [0], 
                proposal.calldata,
                descriptionHash
            )
        } catch (e) {
            console.log(e)
        }
    }

    invest = async (e) => {
        const { governanceToken, accounts, investInput } = this.state
        e.preventDefault()
        try {
            // TODO: mint max_supply of GT to a contract that has exchange method
            // Right now need manual approval of token transfer and no eth is needed other than gas
            // await governanceToken.approve("0xc7966F141398364700177fe6871fe1E3E60Ebc4F", 1000000)
            // await governanceToken.approve("0x8A4298bc642E0014A1C36a83efaf3F6D972C7bD9", 1000000)
            await governanceToken.transferFrom("0x9C8b054ba9E08c7C1dC15e33E24Ca0dB23fcdeD4", accounts[0], investInput)
            const delegate = await governanceToken.delegates(accounts[0])
            if (Number(delegate) === 0) {   
                await governanceToken.delegate(accounts[0])
            }
        } catch (e) {
            console.log(e)
        }
    }

    proposalButton = (proposal) => {
        if (proposal.state === "Pending" || proposal.state === "Active") {
            return (
                <button  
                    onClick={() => this.vote(proposal.id)}
                    disabled={proposal.state !== "Active"}
                > Vote </button>
            )
        } else if (proposal.state === "Succeeded") {
            return (
                <button  
                    onClick={() => this.queue(proposal)}
                > Queue </button>
            )
        } else if (proposal.state === "Queued") {
            return (
                <button  
                    onClick={() => this.execute(proposal)}
                    disabled={proposal.eta.toNumber() > Date.now()}
                > {proposal.eta.toNumber() > Date.now() ? "In Queue until " + new Date(proposal.eta.toNumber()) : "Execute"} </button>
            )
        }
    }

    render() {
        const {
            provider, accounts, chainId,
            box, boxValue, boxInput, descriptionInput,
            proposals, inDao,investInput
        } = this.state

        if (!provider || !box) {
            return <div>Loading Web3, accounts, and contracts...</div>
        }

        // <=42 to exclude Kovan, <42 to include Kovan
        if (isNaN(chainId) || chainId < 4) {
            return <div>Wrong Network! Switch to your local RPC "Localhost: 8545" in your Web3 provider (e.g. Metamask)</div>
        }

        const isAccountsUnlocked = accounts ? accounts.length > 0 : false

        return (
            <div className="App">
                <h1>Bare Bone Dao</h1>
                {
                    !isAccountsUnlocked ?
                        <p>
                            <strong>Connect with Metamask and refresh the page.</strong>
                        </p>
                        : null
                }
                <form onSubmit={(e) => this.invest(e)}>
                    <div>
                        <label>Choose amount to invest: </label>
                        <br/>
                        <input
                            name="investInput"
                            type="number"
                            value={investInput}
                            onChange={(e) => this.setState({investInput: e.target.value})}
                        />
                        <br/>
                        <button type="submit" disabled={!isAccountsUnlocked}>Invest</button>
                    </div>
                </form>
                <h2>Box Contract</h2>

                <div>The stored value is</div> 
                <div>{
                    boxValue.map(item => 
                        <p key={item}>{item}</p>
                    )
                }</div>

                {inDao ?
                <div>
                    <h2>Proposals</h2>
                    <form onSubmit={(e) => this.propose(e)}>
                        <div>
                            <label>Propose a new value: </label>
                            <br/>
                            <input
                                name="boxInput"
                                type="text"
                                autoComplete="off"
                                value={boxInput}
                                onChange={(e) => this.setState({boxInput: e.target.value})}
                            />
                            <br/>
                            <label>Write a short description: </label>
                            <br/>
                            <input
                                name="boxInput"
                                type="text"
                                autoComplete="off"
                                value={descriptionInput}
                                onChange={(e) => this.setState({descriptionInput: e.target.value})}
                            />
                            <br/>
                            <button type="submit" disabled={!isAccountsUnlocked}>Submit</button>
                        </div>
                    </form>
                    <div>{
                        proposals.reverse().map(proposal => (
                            <div key={proposal.id}>
                                <p>{"Proposal ID: " + proposal.id}</p>
                                <p>{proposal.description}</p>
                                <p>{"for: " + proposal.forVotes}</p>
                                <p>{"against: " + proposal.againstVotes}</p>
                                <p>{"state: " + proposal.state}</p>
                                <p>{proposal.deadline > 0 ? "Voting ends in " + proposal.deadline + " blocks": "Voting ended"}</p>
                                {this.proposalButton(proposal)}
                            </div>
                        ))
                    }</div>
                    <br/>
                </div>
                :
                null
                }
            </div>
        )
    }
}

export default App
