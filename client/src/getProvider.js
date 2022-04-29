import { ethers } from "ethers";
import {getEthereum} from "./getEthereum";

export const getProvider = async () => {

    const ethereum = await getEthereum()
    let provider

    if (ethereum) {
        provider = new ethers.providers.Web3Provider(ethereum)
    } else if (window.web3) {
        provider = window.web3
    } else {
        provider = ethers.getDefaultProvider()
    }

    return provider
}