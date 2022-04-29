export const getProposalState = (i) => {
    return ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"][i]
};
