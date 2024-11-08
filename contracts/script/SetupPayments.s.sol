// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {Script} from "forge-std/Script.sol";
import {HelloWorldDeploymentLib} from "./utils/HelloWorldDeploymentLib.sol";
import {CoreDeploymentLib} from "./utils/CoreDeploymentLib.sol";
import {SetupPaymentsLib} from "./utils/SetupPaymentsLib.sol";
import {IRewardsCoordinator} from "@eigenlayer/contracts/interfaces/IRewardsCoordinator.sol";
import {IStrategy} from "@eigenlayer/contracts/interfaces/IStrategy.sol";
import {ERC20Mock} from "../test/ERC20Mock.sol";

import "forge-std/Test.sol";

contract SetupPayments is Script, Test {
    struct PaymentInfo { 
        address recipient;
        uint32 numPayments;
        uint32 amountPerPayment;
        uint32 duration;
        uint32 startTimestamp;
        uint32 endTimestamp;
        uint256 indexToProve;
    }

    address private deployer;
    CoreDeploymentLib.DeploymentData coreDeployment;
    CoreDeploymentLib.DeploymentConfigData coreConfig;

    HelloWorldDeploymentLib.DeploymentData helloWorldDeployment;
    HelloWorldDeploymentLib.DeploymentConfigData helloWorldConfig;

    IRewardsCoordinator rewardsCoordinator;
    string internal constant paymentInfofilePath = "test/mockData/scratch/payment_info.json";
    string internal constant filePath = "test/mockData/scratch/payments.json";


    
    uint32 constant CALCULATION_INTERVAL_SECONDS = 1 days;
    uint256 constant NUM_TOKEN_EARNINGS = 1;
    uint32 constant DURATION = 1 weeks;
    uint256 constant NUM_EARNERS = 8;
    uint256 constant TOKEN_EARNINGS = 100;


    function setUp() public {
        deployer = vm.rememberKey(vm.envUint("PRIVATE_KEY"));
        vm.label(deployer, "Deployer");

        coreDeployment = CoreDeploymentLib.readDeploymentJson("deployments/core/", block.chainid);
        coreConfig = CoreDeploymentLib.readDeploymentConfigValues("config/core/", block.chainid);
        helloWorldDeployment = HelloWorldDeploymentLib.readDeploymentJson("deployments/hello-world/", block.chainid);
        helloWorldConfig = HelloWorldDeploymentLib.readDeploymentConfigValues("config/hello-world/", block.chainid);

        rewardsCoordinator = IRewardsCoordinator(coreDeployment.rewardsCoordinator);

        // TODO: Get the filePath from config
    }

    function run() external {
        vm.startBroadcast(helloWorldConfig.rewardsInitiatorKey);
        PaymentInfo memory info = abi.decode(vm.parseJson(vm.readFile(paymentInfofilePath)), (PaymentInfo));
        (address[] memory earners, IRewardsCoordinator.EarnerTreeMerkleLeaf[] memory earnerLeaves) = _getEarnerAndEarnerLeaves(helloWorldDeployment.strategy);

    

        uint32 startTimestamp = uint32(block.timestamp) - (uint32(block.timestamp) % CALCULATION_INTERVAL_SECONDS);


        emit log_named_uint("numPayments hello", info.numPayments);
        
        uint32 numPayments = 8;
        uint32 endTimestamp = startTimestamp + 1;
        createAVSRewardsSubmissions(numPayments, info.amountPerPayment, startTimestamp);
        vm.stopBroadcast();

        vm.startBroadcast(deployer);
        submitPaymentRoot(earners, endTimestamp, numPayments, uint32(info.amountPerPayment));

        // processClaim(filePath, info.indexToProve, info.recipient, earnerLeaves[info.indexToProve]);

        vm.stopBroadcast();
    }


    function createAVSRewardsSubmissions(uint256 numPayments, uint256 amountPerPayment, uint32 startTimestamp) public {
        ERC20Mock(helloWorldDeployment.token).mint(helloWorldConfig.rewardsInitiator, amountPerPayment * numPayments);
        ERC20Mock(helloWorldDeployment.token).increaseAllowance(helloWorldDeployment.helloWorldServiceManager, amountPerPayment * numPayments);
        uint32 duration = rewardsCoordinator.MAX_REWARDS_DURATION();
        SetupPaymentsLib.createAVSRewardsSubmissions(
            helloWorldDeployment.helloWorldServiceManager,
            helloWorldDeployment.strategy,
            numPayments,
            amountPerPayment,
            duration,
            startTimestamp
        );
    }

    function processClaim(string memory filePath, uint256 indexToProve, address recipient, IRewardsCoordinator.EarnerTreeMerkleLeaf memory earnerLeaf) public {
        SetupPaymentsLib.processClaim(
            IRewardsCoordinator(coreDeployment.rewardsCoordinator),
            filePath,
            indexToProve,
            recipient,
            earnerLeaf,
            NUM_TOKEN_EARNINGS,
            helloWorldDeployment.strategy
        );
    }

    function submitPaymentRoot(address[] memory earners, uint32 endTimestamp, uint32 numPayments, uint32 amountPerPayment) public {
        bytes32[] memory tokenLeaves = SetupPaymentsLib.createTokenLeaves(
            IRewardsCoordinator(coreDeployment.rewardsCoordinator), 
            NUM_TOKEN_EARNINGS, 
            amountPerPayment, 
            helloWorldDeployment.strategy
        );
        IRewardsCoordinator.EarnerTreeMerkleLeaf[] memory earnerLeaves = SetupPaymentsLib.createEarnerLeaves(earners, tokenLeaves);
        emit log_named_uint("Earner Leaves Length", earnerLeaves.length);
        emit log_named_uint("numPayments", numPayments);    

        SetupPaymentsLib.submitRoot(
            IRewardsCoordinator(coreDeployment.rewardsCoordinator),
            tokenLeaves,
            earnerLeaves,
            helloWorldDeployment.strategy,
            endTimestamp,
            numPayments, 
            NUM_TOKEN_EARNINGS,
            filePath
        );
    }

    function _getEarnerAndEarnerLeaves(address strategy) internal returns (address[] memory, IRewardsCoordinator.EarnerTreeMerkleLeaf[] memory) {
        address[] memory earners = new address[](NUM_EARNERS);
        for (uint256 i = 0; i < earners.length; i++) {
            earners[i] = address(1);
        }
        bytes32[] memory tokenLeaves = SetupPaymentsLib.createTokenLeaves(IRewardsCoordinator(coreDeployment.rewardsCoordinator), NUM_TOKEN_EARNINGS, TOKEN_EARNINGS, strategy);
        IRewardsCoordinator.EarnerTreeMerkleLeaf[] memory earnerLeaves =SetupPaymentsLib.createEarnerLeaves(earners, tokenLeaves);

        return (earners, earnerLeaves);
    }
}