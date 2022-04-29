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
        descriptionInput: "",
        governor: null,
        proposals: []
    }

    componentDidMount = async () => {

        // Get network provider and web3 instance.
        const provider = await getProvider()

        let accounts
        // Try and enable accounts (connect metamask)
        try {
            const ethereum = await getEthereum()
            accounts = await ethereum.request({ method: 'eth_requestAccounts' })
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
        const { box, governor, proposals } = this.state
        proposals.forEach(async (proposal) => {
            const args = [["caonima"]]
            console.log("yeet")
            const functionToCall = "store"
            const encodedFunctionCall = box.interface.encodeFunctionData(functionToCall, args)
            const descriptionHash = ethers.utils.id(proposal.description)
            const checkId = await governor.hashProposal(
                [box.address],
                [0],
                [encodedFunctionCall],
                descriptionHash
            )
            if (checkId.hex === proposal.id.hex) {
                if (proposal.state === "Succeeded") {
                    try {
                        const queueTx = await governor.queue(
                            [box.address], 
                            [0], 
                            [encodedFunctionCall], 
                            descriptionHash
                        )
                        await queueTx.wait(2)
                        this.loadProposals()
                    } catch (e) {
                        console.log(e)
                    }
                } else if (proposal.state === "Queued") {
                    try {
                        const executeTx = await governor.execute(
                            [box.address],
                            [0],
                            [encodedFunctionCall],
                            descriptionHash
                        )
                        await executeTx.wait(2)
                        this.loadProposals()
                    } catch (e) {
                        console.log(e)
                    }
                }
            } else {
                console.log("Proposal changed...")
            }
        });
    }

    loadInitialContracts = async () => {
        // <=42 to exclude Kovan, <42 to include kovan
        if (this.state.chainId < 4) {
            // Wrong Network!
            return
        }
        
        var _chainID = 0;
        if (this.state.chainId === 4){
            _chainID = 4;
        }
        if (this.state.chainId === 1337){
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

        this.setState({
            box,
            governor,
            boxValue,
        })

        this.loadProposals()
    }

    loadProposals = async () => {
        const { governor, box } = this.state
        const boxValue = await box.retrieve()
        const proposalCreated = await governor.filters.ProposalCreated();
        const logs = await governor.queryFilter(proposalCreated, 0, "latest");
        const events = logs.map((log) => governor.interface.parseLog(log));
        const proposals = await Promise.all(events.map(async (event) => {
            const { againstVotes, forVotes, abstainVotes } = await governor.proposalVotes(event.args[0])
            return {
                id: event.args[0],
                description: event.args[8],
                againstVotes, 
                forVotes, 
                abstainVotes,
                state: getProposalState(await governor.state(event.args[0])),
            }
        }))
        this.setState({proposals, boxValue})
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
        const { accounts, governor, box, boxInput, descriptionInput } = this.state
        e.preventDefault()
        const encodedFunctionCall = box.interface.encodeFunctionData("store", [[boxInput]])
        try {
            const proposeTx = await governor.propose(
                [box.address],
                [0],
                [encodedFunctionCall],
                descriptionInput
            )

            await proposeTx.wait(1)
            this.loadProposals()
        } catch (e) {
            console.log(e)
        }
    }

    vote = async (id) => {
        const { governor } = this.state
        try {
            const voteTx = await governor.castVoteWithReason(id, 1, "just testing la")
            await voteTx.wait(1)
            this.loadProposals()
        } catch (e) {
            console.log(e)
        }
    }

    render() {
        const {
            provider, accounts, chainId,
            box, boxValue, boxInput, descriptionInput,
            proposals
        } = this.state

        if (!provider) {
            return <div>Loading Web3, accounts, and contracts...</div>
        }

        // <=42 to exclude Kovan, <42 to include Kovan
        if (isNaN(chainId) || chainId < 4) {
            return <div>Wrong Network! Switch to your local RPC "Localhost: 8545" in your Web3 provider (e.g. Metamask)</div>
        }

        if (!box) {
            return <div>Could not find a deployed contract. Check console for details.</div>
        }

        const isAccountsUnlocked = accounts ? accounts.length > 0 : false

        return (
            <div className="App">
                <h1>Bare Bone Dao</h1>
                {
                    !isAccountsUnlocked ?
                        <p><strong>Connect with Metamask and refresh the page to
                            be able to edit the storage fields.</strong>
                        </p>
                        : null
                }
                <h2>Box Contract</h2>

                <div>The stored value is</div> 
                <div>{
                    boxValue.map(item => 
                        <p key={item}>{item}</p>
                    )
                }</div>

                <h2>Proposals</h2>
                <form onSubmit={(e) => this.propose(e)}>
                    <div>
                        <label>Propose a new value: </label>
                        <br/>
                        <input
                            name="boxInput"
                            type="text"
                            value={boxInput}
                            onChange={(e) => this.setState({boxInput: e.target.value})}
                        />
                        <br/>
                        <label>Write a short description: </label>
                        <br/>
                        <input
                            name="boxInput"
                            type="text"
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
                            <button 
                                onClick={() => this.vote(proposal.id)}
                                disabled={proposal.state != "Active"}
                            > Vote </button>
                        </div>
                    ))
                }</div>
                <br/>
            </div>
        )
    }
}

export default App
