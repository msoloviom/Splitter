
pragma solidity ^0.4.24;

contract Splitter  {
    mapping (address => uint256) balanceOf;

    constructor() public{
    }
    
    event LogSplitTransfer(address indexed sender,  address indexed _payee1,  address indexed _payee2, uint256 amount);
    
    function getMsgSender() payable public returns (uint256){
        return msg.value;
    }
    
    function splitTransfer(address _payee1,  address _payee2) payable public returns (bool success) {
        require(msg.value > 0);
        require(_payee1 != msg.sender);
	require(_payee2 != msg.sender);
        require(_payee1 != 0);
        require(_payee2 != 0);
        
        uint halfOfTransafer = msg.value/2;
        balanceOf[_payee1]+= halfOfTransafer;
        balanceOf[_payee2]+= msg.value - halfOfTransafer;
        
        emit LogSplitTransfer(msg.sender, _payee1, _payee2, msg.value);
        return true;
    }
}
